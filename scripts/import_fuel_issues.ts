/**
 * 1. Create one login user per project   (password = "<Project Name>@123")
 * 2. Import day-by-day FUEL ISSUES from the monthly .xlsb timesheets, replacing
 *    the system-generated consolidated monthly fuel totals with the real,
 *    per-day fuel issues recorded on each vehicle sheet (Col[11] = litres).
 *
 * Each fuel issue is attributed to its SITE (Project) via the `source` field
 * (set to the project code), priced at the active AUTO_DIESEL price, and
 * stamped with the vehicle's end-of-day odometer/hour reading.
 *
 * Idempotent: deletes existing fuel issues for matched assets in the
 *   Jan–Apr 2026 window (incl. the old consolidated totals) before re-inserting.
 *
 * Run: npx tsx scripts/import_fuel_issues.ts
 */

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const UPLOADS = "/root/.claude/uploads/0e793a13-eb4c-5561-a4fd-d386f6b9819e";
const FILES = [
  { path: path.join(UPLOADS, "9bf3fcb8-01_January_2026.xlsb"),  year: 2026, month: 1 },
  { path: path.join(UPLOADS, "da2e905a-02_February_2026.xlsb"), year: 2026, month: 2 },
  { path: path.join(UPLOADS, "643abce9-03_March_2026.xlsb"),    year: 2026, month: 3 },
  { path: path.join(UPLOADS, "fad40363-04_April_2026.xlsb"),    year: 2026, month: 4 },
];

const WINDOW_START = new Date("2026-01-01T00:00:00+05:30");
const WINDOW_END   = new Date("2026-05-01T00:00:00+05:30"); // exclusive

function stripCode(s: string): string {
  return s.toUpperCase().replace(/[\s\-_]/g, "");
}
function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00+05:30`);
}
function toFloat(v: unknown): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

type AssetInfo = { id: string; code: string; meterType: string; projectCode: string | null };
const assetByStripped = new Map<string, AssetInfo>();

const stats = { issues: 0, litres: 0, deleted: 0, unmatched: new Set<string>() };

async function main() {
  console.log("Creating project users + importing daily fuel issues…\n");

  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found — run seed first");

  // ── 1. One login user per project ───────────────────────────────────────────
  const projects = await prisma.project.findMany();
  console.log("Project users:");
  for (const p of projects) {
    const username = p.code.toLowerCase();          // e.g. "cep-abc"
    const password = `${p.name}@123`;               // e.g. "CEP-03 ABC@123"
    const passwordHash = bcrypt.hashSync(password, 10);
    await prisma.user.upsert({
      where: { username },
      create: {
        username,
        name: `${p.name} Site User`,
        role: "USER",
        passwordHash,
        projectId: p.id,
        createdById: sysUser.id,
      },
      update: { passwordHash, projectId: p.id, name: `${p.name} Site User`, active: true },
    });
    console.log(`  ✓ ${p.name.padEnd(18)} username="${username}"  password="${password}"`);
  }
  console.log("");

  // ── 2. Ensure an active AUTO_DIESEL price ────────────────────────────────────
  let price = await prisma.fuelPrice.findFirst({
    where: { fuelKind: "AUTO_DIESEL" },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!price) {
    price = await prisma.fuelPrice.create({
      data: {
        fuelKind: "AUTO_DIESEL",
        pricePerLitre: 35000, // Rs 350.00 / L
        effectiveFrom: WINDOW_START,
        source: "MANUAL",
        note: "Seeded for daily fuel issue import (Jan–Apr 2026)",
        enteredById: sysUser.id,
      },
    });
    console.log(`Created AUTO_DIESEL price: Rs ${price.pricePerLitre / 100}/L\n`);
  }
  const pricePerLitre = price.pricePerLitre;

  // ── 3. Asset lookup ──────────────────────────────────────────────────────────
  const assets = await prisma.asset.findMany({
    select: { id: true, code: true, meterType: true, project: { select: { code: true } } },
  });
  for (const a of assets) {
    assetByStripped.set(stripCode(a.code), {
      id: a.id,
      code: a.code,
      meterType: a.meterType,
      projectCode: a.project?.code ?? null,
    });
  }

  // ── 4. Clear existing fuel issues in window for matched assets ────────────────
  const matchedAssetIds = new Set<string>();

  // First pass: discover which assets appear in the sheets
  const sheetData: { asset: AssetInfo; rows: { date: Date; litres: number; meter: number; meterType: string }[] }[] = [];
  for (const file of FILES) {
    if (!fs.existsSync(file.path)) { console.warn(`  ⚠ missing ${file.path}`); continue; }
    const wb = XLSX.readFile(file.path, { cellDates: false });
    for (const sheetName of wb.SheetNames) {
      if (sheetName === "Sheet1" || sheetName.toLowerCase().startsWith("summary")) continue;
      const asset = assetByStripped.get(stripCode(sheetName));
      if (!asset) { stats.unmatched.add(sheetName); continue; }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
      const meterType = asset.meterType === "KM" ? "KM" : "HOURS";
      const fuelRows: { date: Date; litres: number; meter: number; meterType: string }[] = [];
      for (const row of rows.slice(11)) {
        const date = parseDate((row as unknown[])[1]);
        if (!date) continue;
        const cs = date.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
        const [dy, dm] = cs.split("-").map(Number);
        if (dy !== file.year || dm !== file.month) continue;
        const litres = toFloat((row as unknown[])[11]);
        if (litres <= 0) continue;
        const endMeter = toFloat((row as unknown[])[4]);
        fuelRows.push({ date, litres, meter: endMeter, meterType });
      }
      if (fuelRows.length > 0) {
        matchedAssetIds.add(asset.id);
        sheetData.push({ asset, rows: fuelRows });
      }
    }
  }

  const del = await prisma.fuelIssue.deleteMany({
    where: { assetId: { in: [...matchedAssetIds] }, issueDate: { gte: WINDOW_START, lt: WINDOW_END } },
  });
  stats.deleted = del.count;
  console.log(`Cleared ${stats.deleted} existing fuel issues (incl. system-generated totals).\n`);

  // ── 5. Insert per-day fuel issues ────────────────────────────────────────────
  for (const { asset, rows } of sheetData) {
    for (const r of rows) {
      await prisma.fuelIssue.create({
        data: {
          assetId: asset.id,
          fuelKind: "AUTO_DIESEL",
          litres: r.litres,
          meterReading: r.meter > 0 ? r.meter : null,
          readingType: r.meter > 0 ? r.meterType : null,
          pricePerLitre,
          totalCost: Math.round(r.litres * pricePerLitre),
          issueDate: r.date,
          source: asset.projectCode ?? "SITE", // site attribution
          issuedById: sysUser.id,
          fuelPriceId: price.id,
        },
      });
      stats.issues++;
      stats.litres += r.litres;
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "IMPORT",
      entity: "FuelIssue",
      entityId: "bulk",
      summary: `Daily fuel import: ${stats.issues} issues (${stats.litres} L) Jan–Apr 2026; replaced ${stats.deleted} prior issues; created ${projects.length} project users`,
    },
  });

  console.log("── Summary ──────────────────────────────────");
  console.log(`  Fuel issues created : ${stats.issues}`);
  console.log(`  Total litres        : ${stats.litres}`);
  console.log(`  Project users       : ${projects.length}`);
  if (stats.unmatched.size > 0) {
    console.log(`  Unmatched sheets (${stats.unmatched.size}): ${[...stats.unmatched].join(", ")}`);
  }
  console.log("────────────────────────────────────────────");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
