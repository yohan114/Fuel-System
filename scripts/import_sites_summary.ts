/**
 * Import summary-sheet data for new and existing sites:
 *
 * NEW PROJECTS (created here):
 *   - Inginimitiya     (code: INGI)  — from Inginimitiya_Vehicle_Machinery_summary.xlsx
 *   - Karativu Bridge  (code: KB)    — from machines_cost_Karativu_Bridge.xlsb
 *
 * EXISTING PROJECT (Gampaha Bridge, code: GB):
 *   - Additional Jan–Mar 2026 monthly data from machines_Vehicles_at_Gampaha_Bridge__2.xlsb
 *   - New vehicles: PJ-6376 (Crew Cab), VR-71 (4t Roller)
 *
 * EXTRA CEP DATA:
 *   - May 2026 day-by-day running sheet (05_May_2026.xlsb) — same format as Jan–Apr
 *
 * For monthly summary sheets (Inginimitiya / Karativu / Gampaha):
 *   - Vehicles not in DB are created and assigned to their project
 *   - One FuelIssue per vehicle per month (total litres, on last day of month)
 *   - No DailyConditions (no day-by-day data in summary sheets)
 *
 * For May 2026 day-by-day sheet:
 *   - DailyCondition WORKING + MeterReading START/END per working day
 *   - FuelIssue per fuelling event
 *
 * FUEL PRICES: Ceypetco site blocked automated fetch. Using Rs 350/L placeholder.
 *   Update via Admin → Settings → Fuel Prices after confirming actual prices.
 *
 * Run: npx tsx scripts/import_sites_summary.ts
 */

import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// ── env ───────────────────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const UPLOADS = "C:/Users/HP/Downloads";

// ── Helpers ───────────────────────────────────────────────────────────────────
function toFloat(v: unknown): number { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; }
function stripCode(s: string) { return s.toUpperCase().replace(/[\s\-_]/g, ""); }

function lastDayOfMonth(year: number, month: number): Date {
  // Last day at Colombo midnight
  const d = new Date(year, month, 0); // day 0 of next month = last day of this month
  return new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T00:00:00+05:30`);
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}T00:00:00+05:30`);
}

// Month name → number
const MONTH_MAP: Record<string, number> = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12
};
function parseSheetMonth(name: string): { year: number; month: number } | null {
  const parts = name.trim().toLowerCase().split(/\s+/);
  const month = MONTH_MAP[parts[0]];
  const year = parseInt(parts[1]);
  if (!month || isNaN(year)) return null;
  return { year, month };
}

// ── State ──────────────────────────────────────────────────────────────────────
let sysUserId = "";
let pricePerLitre = 35000; // Rs 350/L in cents — update via admin UI
let priceId = "";

const assetCache = new Map<string, { id: string; code: string; meterType: string }>();

const stats = { projects: 0, vehicles: 0, fuelIssues: 0, conditions: 0, readings: 0 };

// ── Ensure asset exists ────────────────────────────────────────────────────────
async function ensureAsset(code: string, typeLabel: string, catCode: string, projectId: string | null): Promise<string> {
  const key = stripCode(code);
  const cached = assetCache.get(key);
  if (cached) return cached.id;

  const cat = await prisma.category.findUnique({ where: { code: catCode } });
  if (!cat) throw new Error(`Category not found: ${catCode}`);

  const asset = await prisma.asset.upsert({
    where: { code },
    create: { code, typeLabel, categoryId: cat.id, meterType: cat.defaultMeterType, status: "ACTIVE", projectId },
    update: {}, // don't overwrite existing
  });
  assetCache.set(key, { id: asset.id, code: asset.code, meterType: asset.meterType });
  return asset.id;
}

// ── Import one monthly summary row ─────────────────────────────────────────────
async function importMonthlySummary(
  vehicleCode: string,
  typeLabel: string,
  catCode: string,
  projectId: string | null,
  year: number,
  month: number,
  fuelLitres: number
) {
  if (fuelLitres <= 0) return;
  const assetId = await ensureAsset(vehicleCode, typeLabel, catCode, projectId);
  const issueDate = lastDayOfMonth(year, month);

  // Skip if already imported
  const existing = await prisma.fuelIssue.findFirst({
    where: { assetId, issueDate, source: "SUMMARY_SHEET" },
  });
  if (existing) return;

  await prisma.fuelIssue.create({
    data: {
      assetId,
      fuelKind: "AUTO_DIESEL",
      litres: fuelLitres,
      pricePerLitre,
      totalCost: Math.round(fuelLitres * pricePerLitre),
      issueDate,
      source: "SUMMARY_SHEET",
      issuedById: sysUserId,
      fuelPriceId: priceId,
    },
  });
  stats.fuelIssues++;
}

// ── Process monthly summary sheet (Inginimitiya / Karativu / Gampaha format) ──
async function processSummarySheet(
  rows: unknown[][],
  sheetName: string,
  defaultProjectId: string | null
) {
  const period = parseSheetMonth(sheetName);
  if (!period) return;

  // Data rows: skip rows 0-2 (header); each vehicle row has Vehicle No in col[1], fuel in col[5] or col[6]
  for (const row of rows.slice(3)) {
    const rawCode = String((row as unknown[])[1] || "").trim();
    if (!rawCode || rawCode.toLowerCase().startsWith("external") || rawCode.toLowerCase() === "vehicle no.") continue;
    if (!rawCode.match(/^[A-Z0-9\-]+$/i)) continue; // skip blank/total rows

    // Detect column layout — two formats exist:
    // Format A (Inginimitiya Jan): [No, VehicleNo, Type, ActualHrs, CostHrs, Distance, Fuel, Cons, Rate, Total, Owner]
    //   → fuel at col[6]
    // Format B (Karativu/Gampaha): [No, VehicleNo, Type, ActualHrs, Distance, Fuel, Cons, Rate, Actual, Owner]
    //   → fuel at col[5]
    const colA = (row as unknown[])[3]; // actual hrs
    const fuelA = toFloat((row as unknown[])[6]);
    const fuelB = toFloat((row as unknown[])[5]);

    // Use whichever fuel col looks more reasonable
    const typeLabel = String((row as unknown[])[2] || "Vehicle").trim() || "Vehicle";
    let fuelLitres = fuelA > 0 ? fuelA : fuelB;
    if (fuelLitres <= 0) continue; // no fuel recorded

    // Map type → category code
    const cat = mapTypeToCategory(typeLabel);
    const vehicleCode = rawCode.toUpperCase();

    await importMonthlySummary(vehicleCode, typeLabel, cat, defaultProjectId, period.year, period.month, fuelLitres);
  }
}

function mapTypeToCategory(typeLabel: string): string {
  const t = typeLabel.toLowerCase();
  if (t.includes("excavator") || t.includes("hex")) return "HEX";
  if (t.includes("backhoe")) return "BHL";
  if (t.includes("skid")) return "SL";
  if (t.includes("roller") || t.includes("compactor")) return "VR";
  if (t.includes("grader")) return "MG";
  if (t.includes("crane")) return "CR";
  if (t.includes("wheel load")) return "WL";
  if (t.includes("boom")) return "BT";
  if (t.includes("tipper") || t.includes("dump")) return "TT";
  if (t.includes("bowser") || t.includes("tanker")) return "FB";
  if (t.includes("mixer") || t.includes("concrete")) return "CM";
  if (t.includes("crew") || t.includes("cab") || t.includes("pick")) return "PU";
  return "OTHER";
}

// ── Process May 2026 day-by-day sheet ─────────────────────────────────────────
async function processDailySheet(sheetName: string, rows: unknown[][], year: number, month: number) {
  if (sheetName === "Sheet1" || sheetName.toLowerCase().startsWith("summary")) return;

  const key = stripCode(sheetName);
  const asset = assetCache.get(key);
  if (!asset) {
    console.warn(`    ⚠ No asset matched for sheet "${sheetName}"`);
    return;
  }

  const meterType = asset.meterType === "KM" ? "KM" : "HOURS";
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);

  // Clear existing DAILY_SHEET readings for idempotency
  await prisma.meterReading.deleteMany({
    where: { assetId: asset.id, source: { in: ["DAILY_SHEET_START","DAILY_SHEET_END"] }, readingDate: { gte: monthStart, lt: monthEnd } },
  });

  for (const row of rows.slice(11)) {
    const date = parseDate((row as unknown[])[1]);
    if (!date) continue;
    const cs = date.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
    const [dy, dm] = cs.split("-").map(Number);
    if (dy !== year || dm !== month) continue;

    const startMeter = toFloat((row as unknown[])[2]);
    const endMeter   = toFloat((row as unknown[])[4]);
    const distOrHrs  = toFloat((row as unknown[])[6]);
    const hoursWkd   = toFloat((row as unknown[])[9]);
    const fuelL      = toFloat((row as unknown[])[11]);

    const isWorking = distOrHrs > 0 || hoursWkd > 0;
    if (!isWorking) continue;

    // DailyCondition
    await prisma.dailyCondition.upsert({
      where: { assetId_logDate: { assetId: asset.id, logDate: date } },
      create: { assetId: asset.id, logDate: date, status: "WORKING", recordedById: sysUserId },
      update: { status: "WORKING" },
    });
    stats.conditions++;

    // Meter readings
    const readings: { value: number; source: string }[] = [];
    if (startMeter > 0) readings.push({ value: startMeter, source: "DAILY_SHEET_START" });
    if (endMeter > 0 && endMeter !== startMeter) readings.push({ value: endMeter, source: "DAILY_SHEET_END" });
    for (const r of readings) {
      await prisma.meterReading.create({
        data: { assetId: asset.id, readingType: meterType, value: r.value, readingDate: date, source: r.source, recordedById: sysUserId },
      });
      stats.readings++;
    }

    // Fuel issue on days with fuelling
    if (fuelL > 0) {
      const existingFuel = await prisma.fuelIssue.findFirst({ where: { assetId: asset.id, issueDate: date, litres: fuelL } });
      if (!existingFuel) {
        const endM = endMeter > 0 ? endMeter : null;
        await prisma.fuelIssue.create({
          data: {
            assetId: asset.id, fuelKind: "AUTO_DIESEL", litres: fuelL,
            meterReading: endM, readingType: endM ? meterType : null,
            pricePerLitre, totalCost: Math.round(fuelL * pricePerLitre),
            issueDate: date, source: "DAILY_SHEET", issuedById: sysUserId, fuelPriceId: priceId,
          },
        });
        stats.fuelIssues++;
      }
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Importing sites summary + May 2026 daily data…\n");

  const sysUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!sysUser) throw new Error("No admin user — run seed first");
  sysUserId = sysUser.id;

  // Ensure fuel price
  let price = await prisma.fuelPrice.findFirst({ where: { fuelKind: "AUTO_DIESEL" }, orderBy: { effectiveFrom: "desc" } });
  if (!price) {
    price = await prisma.fuelPrice.create({
      data: { fuelKind: "AUTO_DIESEL", pricePerLitre: 35000, effectiveFrom: new Date("2026-01-01T00:00:00+05:30"), source: "MANUAL", note: "Placeholder — update via admin UI", enteredById: sysUserId },
    });
  }
  pricePerLitre = price.pricePerLitre;
  priceId = price.id;

  // Pre-load existing assets
  const existing = await prisma.asset.findMany({ select: { id: true, code: true, meterType: true } });
  for (const a of existing) assetCache.set(stripCode(a.code), { id: a.id, code: a.code, meterType: a.meterType });
  console.log(`Loaded ${existing.length} existing assets.\n`);

  // ── 1. Inginimitiya ──────────────────────────────────────────────────────────
  console.log("── Inginimitiya ──────────────────────────────────────────────");
  const ingiFile = path.join(UPLOADS, "Inginimitiya Vehicle, Machinery summary.xlsx");
  let ingiProject = await prisma.project.findFirst({ where: { code: "INGI" } });
  if (!ingiProject) {
    ingiProject = await prisma.project.create({ data: { name: "Inginimitiya", code: "INGI" } });
    stats.projects++;
    // Create site user
    await prisma.user.upsert({
      where: { username: "ingi" },
      create: { username: "ingi", name: "Inginimitiya Site User", role: "USER", passwordHash: bcrypt.hashSync("Inginimitiya@123", 10), projectId: ingiProject.id, createdById: sysUserId },
      update: { projectId: ingiProject.id },
    });
    console.log(`  ✓ Created project Inginimitiya  username=ingi  password=Inginimitiya@123`);
  }

  if (fs.existsSync(ingiFile)) {
    const wb = XLSX.readFile(ingiFile, { cellDates: false });
    for (const sn of wb.SheetNames) {
      const period = parseSheetMonth(sn);
      if (!period || period.year < 2026) { console.log(`  skip ${sn}`); continue; }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: "" });
      await processSummarySheet(rows, sn, ingiProject.id);
      console.log(`  ✓ ${sn.trim()}`);
    }
  } else {
    console.warn(`  ⚠ File not found: ${ingiFile}`);
  }

  // ── 2. Karativu Bridge ───────────────────────────────────────────────────────
  console.log("\n── Karativu Bridge ───────────────────────────────────────────");
  const kbFile = path.join(UPLOADS, "machines cost Karativu Bridge - 1.xlsb");
  let kbProject = await prisma.project.findFirst({ where: { code: "KB" } });
  if (!kbProject) {
    kbProject = await prisma.project.create({ data: { name: "Karativu Bridge", code: "KB" } });
    stats.projects++;
    await prisma.user.upsert({
      where: { username: "kb" },
      create: { username: "kb", name: "Karativu Bridge Site User", role: "USER", passwordHash: bcrypt.hashSync("Karativu Bridge@123", 10), projectId: kbProject.id, createdById: sysUserId },
      update: { projectId: kbProject.id },
    });
    console.log(`  ✓ Created project Karativu Bridge  username=kb  password=Karativu Bridge@123`);
  }

  if (fs.existsSync(kbFile)) {
    const wb = XLSX.readFile(kbFile, { cellDates: false });
    for (const sn of wb.SheetNames) {
      const period = parseSheetMonth(sn);
      if (!period || period.year < 2026) { console.log(`  skip ${sn}`); continue; }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: "" });
      await processSummarySheet(rows, sn, kbProject.id);
      console.log(`  ✓ ${sn.trim()}`);
    }
  } else {
    console.warn(`  ⚠ File not found: ${kbFile}`);
  }

  // ── 3. Gampaha Bridge 2 (new monthly data Jan–Mar 2026) ──────────────────────
  console.log("\n── Gampaha Bridge (supplemental Jan–Mar 2026) ────────────────");
  const gbFile = path.join(UPLOADS, "machines, Vehicles at Gampaha Bridge - 2.xlsb");
  const gbProject = await prisma.project.findFirst({ where: { code: "GB" } });
  if (!gbProject) {
    console.warn("  ⚠ Gampaha Bridge project not found");
  } else {
    // Ensure PJ-6376 and VR-71 exist in the project
    await ensureAsset("PJ-6376", "Crew Cab", "PU", gbProject.id);
    await ensureAsset("VR-71", "4 Ton Roller", "VR", gbProject.id);

    if (fs.existsSync(gbFile)) {
      const wb = XLSX.readFile(gbFile, { cellDates: false });
      for (const sn of wb.SheetNames) {
        const period = parseSheetMonth(sn);
        if (!period || period.year < 2026) { console.log(`  skip ${sn}`); continue; }
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: "" });
        await processSummarySheet(rows, sn, gbProject.id);
        console.log(`  ✓ ${sn.trim()}`);
      }
    } else {
      console.warn(`  ⚠ File not found: ${gbFile}`);
    }
  }

  // ── 4. May 2026 day-by-day running ────────────────────────────────────────────
  console.log("\n── May 2026 daily running ────────────────────────────────────");
  const mayFile = path.join(UPLOADS, "05 May 2026.xlsb");
  if (fs.existsSync(mayFile)) {
    const wb = XLSX.readFile(mayFile, { cellDates: false });
    for (const sn of wb.SheetNames) {
      if (sn === "Sheet1") continue;
      // Reload asset cache in case new ones were created above
      const key = stripCode(sn);
      if (!assetCache.has(key)) {
        const a = await prisma.asset.findFirst({ where: { code: { contains: sn.trim().toUpperCase() } } });
        if (a) assetCache.set(key, { id: a.id, code: a.code, meterType: a.meterType });
      }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: "" });
      await processDailySheet(sn, rows, 2026, 5);
      const asset = assetCache.get(key);
      console.log(`  ✓ ${sn} → ${asset ? asset.code : "⚠ unmatched"}`);
    }
  } else {
    console.warn(`  ⚠ May 2026 file not found: ${mayFile}`);
  }

  // ── Audit log ──────────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      action: "IMPORT",
      entity: "Project",
      entityId: "bulk",
      summary: `Sites import: ${stats.projects} new projects, ${stats.vehicles} new vehicles, ${stats.fuelIssues} fuel issues, ${stats.conditions} conditions, ${stats.readings} meter readings`,
    },
  });

  console.log(`\n── Summary ───────────────────────────────────────────────────`);
  console.log(`  New projects      : ${stats.projects}`);
  console.log(`  Fuel issues added : ${stats.fuelIssues}`);
  console.log(`  Working conditions: ${stats.conditions}`);
  console.log(`  Meter readings    : ${stats.readings}`);
  console.log(`\n  ⚠ Fuel price: Rs ${pricePerLitre/100}/L (placeholder)`);
  console.log(`    Update actual Ceypetco prices via Admin → Fuel Prices`);
  console.log(`──────────────────────────────────────────────────────────────`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
