/**
 * Import day-by-day vehicle running data from monthly Excel (.xlsb) files.
 *
 * Input files (4 months, Jan–Apr 2026):
 *   /root/.claude/uploads/.../01_January_2026.xlsb
 *   /root/.claude/uploads/.../02_February_2026.xlsb
 *   /root/.claude/uploads/.../03_March_2026.xlsb
 *   /root/.claude/uploads/.../04_April_2026.xlsb
 *
 * Each workbook: one sheet per vehicle. Sheet layout:
 *   Row 10 = column headers
 *   Row 11+ = daily data (one per calendar day)
 *   Col[0]=ref  Col[1]=date("YYYY.MM.DD")  Col[2]=start meter  Col[4]=end meter
 *   Col[6]=distance/hours  Col[9]=total time worked  Col[11]=fuel litres
 *
 * Imports:
 *   - DailyCondition  WORKING if hours_worked > 0, else skipped (not logged = INACTIVE)
 *   - MeterReading    start (readingDate=day, source=DAILY_SHEET_START) and
 *                     end   (readingDate=day, source=DAILY_SHEET_END)
 *                     both only when numeric meter values > 0
 *
 * Idempotent: uses upsert on DailyCondition (assetId+logDate unique) and
 *   createMany(skipDuplicates) on MeterReading (assetId+readingDate+source+value).
 *
 * Run: npx tsx scripts/import_daily_running.ts
 */

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

// ── Input files ───────────────────────────────────────────────────────────────
const UPLOADS = "/root/.claude/uploads/0e793a13-eb4c-5561-a4fd-d386f6b9819e";
const FILES = [
  { path: path.join(UPLOADS, "9bf3fcb8-01_January_2026.xlsb"),  year: 2026, month: 1 },
  { path: path.join(UPLOADS, "da2e905a-02_February_2026.xlsb"), year: 2026, month: 2 },
  { path: path.join(UPLOADS, "643abce9-03_March_2026.xlsb"),    year: 2026, month: 3 },
  { path: path.join(UPLOADS, "fad40363-04_April_2026.xlsb"),    year: 2026, month: 4 },
];

// ── Asset code normalisation ──────────────────────────────────────────────────
// Build lookup: stripped (no hyphens/spaces, uppercase) → Asset.code
let assetByStripped = new Map<string, { id: string; code: string; meterType: string }>();

function stripCode(s: string): string {
  return s.toUpperCase().replace(/[\s\-_]/g, "");
}

// ── Parse date string "YYYY.MM.DD" ───────────────────────────────────────────
function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (!m) return null;
  // Use Colombo midnight (UTC+5:30 = -330 min offset)
  const y = parseInt(m[1]), mo = parseInt(m[2]), d = parseInt(m[3]);
  return new Date(`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T00:00:00+05:30`);
}

function toFloat(v: unknown): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

// System user for recordedById
let SYSTEM_USER_ID = "";

// ── Stats ──────────────────────────────────────────────────────────────────────
const stats = {
  conditions: 0,
  readings: 0,
  skippedSheets: 0,
  unmatchedSheets: [] as string[],
};

// ── Process one sheet ─────────────────────────────────────────────────────────
async function processSheet(
  sheetName: string,
  rows: unknown[][],
  year: number,
  month: number
) {
  // Skip summary / template sheets
  if (sheetName === "Sheet1" || sheetName.toLowerCase().startsWith("summary")) {
    stats.skippedSheets++;
    return;
  }

  // Match asset
  const asset = assetByStripped.get(stripCode(sheetName));
  if (!asset) {
    stats.unmatchedSheets.push(sheetName);
    return;
  }

  const meterType = asset.meterType === "KM" ? "KM" : "HOURS";

  // Data rows start at index 11 (row 12 in 1-based, after header at row 11)
  const dataRows = rows.slice(11);

  const conditionsToUpsert: { date: Date; status: string }[] = [];
  const readingsToInsert: {
    date: Date;
    source: string;
    value: number;
    meterType: string;
  }[] = [];

  for (const row of dataRows) {
    const dateRaw = (row as unknown[])[1];
    const date = parseDate(dateRaw);
    if (!date) continue;

    // Verify date is within the expected month
    const d = new Date(date);
    // Parse in Colombo tz
    const colomboStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
    const [dy, dm] = colomboStr.split("-").map(Number);
    if (dy !== year || dm !== month) continue;

    const startMeter = toFloat((row as unknown[])[2]);
    const endMeter   = toFloat((row as unknown[])[4]);
    const distOrHrs  = toFloat((row as unknown[])[6]);
    const hoursWkd   = toFloat((row as unknown[])[9]);

    // Determine if working: either distance>0 or hours worked>0 or start+end meters present
    const isWorking = distOrHrs > 0 || hoursWkd > 0;

    if (isWorking) {
      conditionsToUpsert.push({ date, status: "WORKING" });

      // Meter readings: use distance/hours column to determine meter type
      // If both distance (col6) and hours (col9) are available, prefer based on asset meterType
      const meterValue = meterType === "KM" ? distOrHrs : hoursWkd;

      if (startMeter > 0) {
        readingsToInsert.push({
          date,
          source: "DAILY_SHEET_START",
          value: startMeter,
          meterType,
        });
      }
      if (endMeter > 0 && endMeter !== startMeter) {
        readingsToInsert.push({
          date,
          source: "DAILY_SHEET_END",
          value: endMeter,
          meterType,
        });
      }
    }
  }

  // Upsert conditions
  for (const c of conditionsToUpsert) {
    await prisma.dailyCondition.upsert({
      where: { assetId_logDate: { assetId: asset.id, logDate: c.date } },
      create: {
        assetId: asset.id,
        logDate: c.date,
        status: c.status as "WORKING",
        recordedById: SYSTEM_USER_ID,
      },
      update: { status: c.status as "WORKING" },
    });
    stats.conditions++;
  }

  // Delete existing DAILY_SHEET readings for this asset in this month (idempotency)
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);
  await prisma.meterReading.deleteMany({
    where: {
      assetId: asset.id,
      source: { in: ["DAILY_SHEET_START", "DAILY_SHEET_END"] },
      readingDate: { gte: monthStart, lt: monthEnd },
    },
  });

  // Insert meter readings
  if (readingsToInsert.length > 0) {
    const result = await prisma.meterReading.createMany({
      data: readingsToInsert.map((r) => ({
        assetId: asset.id,
        readingType: r.meterType as "KM" | "HOURS",
        value: r.value,
        readingDate: r.date,
        source: r.source,
        recordedById: SYSTEM_USER_ID,
      })),
    });
    stats.readings += result.count;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Importing daily running data…\n");

  // Resolve system user
  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user found — run seed first");
  SYSTEM_USER_ID = sysUser.id;

  // Build asset lookup
  const assets = await prisma.asset.findMany({
    select: { id: true, code: true, meterType: true },
  });
  for (const a of assets) {
    assetByStripped.set(stripCode(a.code), {
      id: a.id,
      code: a.code,
      meterType: a.meterType,
    });
  }
  console.log(`Loaded ${assets.length} assets from DB.\n`);

  for (const file of FILES) {
    if (!fs.existsSync(file.path)) {
      console.warn(`  ⚠ File not found: ${file.path}`);
      continue;
    }

    const monthName = new Date(file.year, file.month - 1).toLocaleString("en-US", {
      month: "long",
    });
    console.log(`Processing ${monthName} ${file.year}…`);

    const wb = XLSX.readFile(file.path, { cellDates: false });

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
      });
      await processSheet(sheetName, rows, file.year, file.month);
    }

    console.log(`  ✓ ${monthName} done`);
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: "IMPORT",
      entity: "DailyCondition",
      entityId: "bulk",
      summary: `Daily running import: ${stats.conditions} working-day conditions, ${stats.readings} meter readings from Jan–Apr 2026 Excel sheets`,
    },
  });

  console.log(`\n── Summary ──────────────────────────────────`);
  console.log(`  Working-day conditions upserted : ${stats.conditions}`);
  console.log(`  Meter readings inserted         : ${stats.readings}`);
  console.log(`  Sheets skipped (template)       : ${stats.skippedSheets}`);
  if (stats.unmatchedSheets.length > 0) {
    console.log(`  Unmatched sheets (${stats.unmatchedSheets.length}):`);
    stats.unmatchedSheets.forEach((s) => console.log(`    - "${s}"`));
  }
  console.log(`────────────────────────────────────────────`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
