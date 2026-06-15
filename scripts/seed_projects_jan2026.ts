/**
 * Seed script: create CEP-03 ABC, CEP-03 E, Gampaha Bridge projects
 * and import all vehicles with January 2026 working-day conditions.
 *
 * Run: npx tsx scripts/seed_projects_jan2026.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

// Load .env manually (same pattern as other scripts)
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

// ─── CATEGORY DEFINITIONS ────────────────────────────────────────────────────
const CATEGORIES = [
  { code: "TT",  name: "Tipper Truck",      defaultMeterType: "KM",    fleetGroup: "ROAD_VEHICLE" },
  { code: "CM",  name: "Concrete Mixer",    defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "FB",  name: "Fuel Bowser",       defaultMeterType: "KM",    fleetGroup: "ROAD_VEHICLE" },
  { code: "PU",  name: "Pick-up Truck",     defaultMeterType: "KM",    fleetGroup: "ROAD_VEHICLE" },
  { code: "HEX", name: "Excavator",         defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "MG",  name: "Motor Grader",      defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "CR",  name: "Crane",             defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "VR",  name: "Compactor / Roller",defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "BHL", name: "Backhoe Loader",    defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "SL",  name: "Skid Loader",       defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "WL",  name: "Wheel Loader",      defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "BT",  name: "Boom Truck",        defaultMeterType: "HOURS", fleetGroup: "ROAD_VEHICLE" },
  { code: "PC",  name: "Pump Car",          defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  { code: "OTHER", name: "Other",           defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
] as const;

type CatCode = typeof CATEGORIES[number]["code"];

function resolveCategory(type: string): CatCode {
  const t = type.toLowerCase().trim();
  if (t.includes("cube") || t.includes("tipper")) return "TT";
  if (t.includes("mixer")) return "CM";
  if (t.includes("bowser")) return "FB";
  if (t.includes("d/cab") || t.includes("s/cab") || t.includes("single cab") || t.includes("pick")) return "PU";
  if (t.includes("c/cab") || t.includes("crew")) return "PU";
  if (t.includes("volvo") || t.includes("komatsu") || t.includes("case") || t.includes("excavator") || t.includes("hyundai")) return "HEX";
  if (t.includes("grader")) return "MG";
  if (t.includes("crane")) return "CR";
  if (t.includes("roller") || t.includes("ton roller")) return "VR";
  if (t.includes("jcb")) return "BHL";
  if (t.includes("skid") || t.includes("bob cat") || t.includes("bobcat")) return "SL";
  if (t.includes("pump car")) return "PC";
  if (t.includes("loader")) return "WL";
  if (t.includes("boom")) return "BT";
  return "OTHER";
}

function meterTypeForCatCode(code: CatCode): "KM" | "HOURS" {
  return ["TT", "PU", "FB"].includes(code) ? "KM" : "HOURS";
}

// ─── PROJECT DATA ─────────────────────────────────────────────────────────────
const PROJECTS = [
  { name: "CEP-03 ABC", code: "CEP-ABC" },
  { name: "CEP-03 E", code: "CEP-E" },
  { name: "Gampaha Bridge", code: "GB" },
];

// vehicle code → { type, project, days (Jan), fuel (L, Jan), consRate, consUnit }
interface VehicleData {
  code: string;
  type: string;
  project: string;
  days: number;
  fuel: number;
  consRate: number;
  consUnit: string; // "km/L" | "L/hr"
}

const VEHICLES: VehicleData[] = [
  // ── CEP-03 ABC ──────────────────────────────────────────────────────────────
  { code: "LA-1359",  type: "Fuel Bowser",   project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 5,    consUnit: "L/hr" },
  { code: "LL-0920",  type: "1 Cube Tipper", project: "CEP-ABC", days: 24,  fuel: 460,  consRate: 6.4,  consUnit: "km/L" },
  { code: "LP-1573",  type: "3 Cube Tipper", project: "CEP-ABC", days: 21,  fuel: 869,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LP-1577",  type: "3 Cube Tipper", project: "CEP-ABC", days: 19,  fuel: 710,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LM-5719",  type: "3 Cube Tipper", project: "CEP-ABC", days: 8,   fuel: 210,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LM-7940",  type: "3 Cube Tipper", project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 3.8,  consUnit: "km/L" },
  { code: "LM-7948",  type: "3 Cube Tipper", project: "CEP-ABC", days: 5,   fuel: 50,   consRate: 3.8,  consUnit: "km/L" },
  { code: "LO-5983",  type: "3 Cube Tipper", project: "CEP-ABC", days: 23,  fuel: 605,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LO-7182",  type: "3 Cube Tipper", project: "CEP-ABC", days: 26,  fuel: 810,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LO-7183",  type: "3 Cube Tipper", project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 3.8,  consUnit: "km/L" },
  { code: "LN-8277",  type: "Boom Truck",    project: "CEP-ABC", days: 20,  fuel: 830,  consRate: 7.2,  consUnit: "L/hr" },
  { code: "HEX-01",   type: "Volvo 220 Excavator",    project: "CEP-ABC", days: 95.8, fuel: 1145, consRate: 11.5, consUnit: "L/hr" },
  { code: "HEX-19",   type: "Komatsu 120 Excavator",  project: "CEP-ABC", days: 126.9,fuel: 855,  consRate: 7.2,  consUnit: "L/hr" },
  { code: "51-8083",  type: "D/Cab Pick-up", project: "CEP-ABC", days: 23,  fuel: 616,  consRate: 12.8, consUnit: "km/L" },
  { code: "DAH-2230", type: "S/Cab Pick-up", project: "CEP-ABC", days: 8,   fuel: 114,  consRate: 14.1, consUnit: "km/L" },
  { code: "PT-1569",  type: "S/Cab Pick-up", project: "CEP-ABC", days: 10,  fuel: 144,  consRate: 14.1, consUnit: "km/L" },
  { code: "PH-6742",  type: "C/Cab Pick-up", project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 12.8, consUnit: "km/L" },
  { code: "325-3448", type: "C/Cab Pick-up", project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 12.8, consUnit: "km/L" },
  { code: "PD-6917",  type: "D/Cab Pick-up", project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 12.8, consUnit: "km/L" },
  { code: "MG-06",    type: "Motor Grader",  project: "CEP-ABC", days: 87.8,fuel: 830,  consRate: 13,   consUnit: "L/hr" },
  { code: "MG-12",    type: "Motor Grader",  project: "CEP-ABC", days: 16.5,fuel: 200,  consRate: 13,   consUnit: "L/hr" },
  { code: "ZA-8395",  type: "Crane",         project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 10.8, consUnit: "L/hr" },
  { code: "ZA-8373",  type: "Pump Car",      project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 13,   consUnit: "L/hr" },
  { code: "SR-19",    type: "10 ton Roller", project: "CEP-ABC", days: 61.9,fuel: 630,  consRate: 4.3,  consUnit: "L/hr" },
  { code: "VR-65",    type: "4 ton Roller",  project: "CEP-ABC", days: 79,  fuel: 425,  consRate: 7.2,  consUnit: "L/hr" },
  { code: "ZA-6069",  type: "Backhoe Loader",project: "CEP-ABC", days: 131.9,fuel: 640, consRate: 5,    consUnit: "L/hr" },
  { code: "ZB-1546",  type: "Backhoe Loader",project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 5,    consUnit: "L/hr" },
  { code: "SL-14",    type: "Skid Loader",   project: "CEP-ABC", days: 108.5,fuel: 495, consRate: 3.2,  consUnit: "L/hr" },
  { code: "ZA-7290",  type: "Concrete Mixer",project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 7.9,  consUnit: "L/hr" },
  { code: "ZA-7291",  type: "Concrete Mixer",project: "CEP-ABC", days: 0,   fuel: 0,    consRate: 7.9,  consUnit: "L/hr" },
  { code: "ZA-8511",  type: "Concrete Mixer",project: "CEP-ABC", days: 16,  fuel: 555,  consRate: 7.9,  consUnit: "L/hr" },
  { code: "LD-09",    type: "Wheel Loader",  project: "CEP-ABC", days: 190, fuel: 1719, consRate: 10.8, consUnit: "L/hr" },
  { code: "ZB-1496",  type: "Concrete Mixer",project: "CEP-ABC", days: 21,  fuel: 1290, consRate: 13,   consUnit: "L/hr" },
  { code: "ZA-0050",  type: "Concrete Mixer",project: "CEP-ABC", days: 18,  fuel: 1095, consRate: 9.4,  consUnit: "L/hr" },

  // ── CEP-03 E ─────────────────────────────────────────────────────────────────
  { code: "LH-5586",  type: "5 Cube Tipper", project: "CEP-E", days: 13,  fuel: 170,  consRate: 2.9,  consUnit: "km/L" },
  { code: "LI-7618",  type: "3 Cube Tipper", project: "CEP-E", days: 1,   fuel: 10,   consRate: 3.8,  consUnit: "km/L" },
  { code: "LM-5722",  type: "3 Cube Tipper", project: "CEP-E", days: 4,   fuel: 30,   consRate: 3.8,  consUnit: "km/L" },
  { code: "LM-5723",  type: "3 Cube Tipper", project: "CEP-E", days: 12,  fuel: 180,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LM-7951",  type: "3 Cube Tipper", project: "CEP-E", days: 21,  fuel: 440,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LJ-5203",  type: "3 Cube Tipper", project: "CEP-E", days: 25,  fuel: 330,  consRate: 3.8,  consUnit: "km/L" },
  { code: "ZA-8033",  type: "Concrete Mixer",project: "CEP-E", days: 20,  fuel: 1026, consRate: 9.4,  consUnit: "L/hr" },
  { code: "ZA-7810",  type: "Concrete Mixer",project: "CEP-E", days: 21,  fuel: 1290, consRate: 9.4,  consUnit: "L/hr" },
  { code: "LP-1566",  type: "3 Cube Tipper", project: "CEP-E", days: 4,   fuel: 350,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LO-7181",  type: "3 Cube Tipper", project: "CEP-E", days: 26,  fuel: 1515, consRate: 3.8,  consUnit: "km/L" },
  { code: "LP-1574",  type: "3 Cube Tipper", project: "CEP-E", days: 10,  fuel: 505,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LP-1572",  type: "3 Cube Tipper", project: "CEP-E", days: 16,  fuel: 615,  consRate: 3.8,  consUnit: "km/L" },
  { code: "LP-1709",  type: "3 Cube Tipper", project: "CEP-E", days: 20,  fuel: 852,  consRate: 3.8,  consUnit: "km/L" },
  { code: "DAH-2229", type: "S/Cab Pick-up", project: "CEP-E", days: 30,  fuel: 509,  consRate: 14.1, consUnit: "km/L" },
  { code: "41-1130",  type: "Fuel Bowser",   project: "CEP-E", days: 30,  fuel: 114,  consRate: 5,    consUnit: "L/hr" },
  { code: "HEX-42",   type: "Case 220 Excavator", project: "CEP-E", days: 29.2,fuel: 230, consRate: 11.5, consUnit: "L/hr" },
  { code: "HEX-45",   type: "Case 220 Excavator", project: "CEP-E", days: 90.6,fuel: 960, consRate: 11.5, consUnit: "L/hr" },
  { code: "MG-18",    type: "Motor Grader",  project: "CEP-E", days: 15.7,fuel: 130,  consRate: 13,   consUnit: "L/hr" },
  { code: "ZA-4344",  type: "Motor Grader",  project: "CEP-E", days: 41.6,fuel: 350,  consRate: 13,   consUnit: "L/hr" },
  { code: "ZB-1980",  type: "Backhoe Loader",project: "CEP-E", days: 119.1,fuel: 560, consRate: 5,    consUnit: "L/hr" },
  { code: "SR-18",    type: "10 ton Roller", project: "CEP-E", days: 15,  fuel: 160,  consRate: 4.3,  consUnit: "L/hr" },
  { code: "SR-17",    type: "10 ton Roller", project: "CEP-E", days: 26,  fuel: 200,  consRate: 4.3,  consUnit: "L/hr" },
  { code: "SL-24",    type: "Skid Loader",   project: "CEP-E", days: 107, fuel: 540,  consRate: 3.2,  consUnit: "L/hr" },
  { code: "LP-1713",  type: "3 Cube Tipper", project: "CEP-E", days: 0,   fuel: 0,    consRate: 3.8,  consUnit: "km/L" },
  { code: "ZA-8445",  type: "Concrete Mixer",project: "CEP-E", days: 0,   fuel: 0,    consRate: 9.4,  consUnit: "L/hr" },
  { code: "LO-7181b", type: "3 Cube Tipper", project: "CEP-E", days: 0,   fuel: 0,    consRate: 3.8,  consUnit: "km/L" }, // LO-7181 dup placeholder

  // ── GAMPAHA BRIDGE ───────────────────────────────────────────────────────────
  { code: "HEX-37",   type: "Hyundai 330 Excavator", project: "GB", days: 88.1,fuel: 1150, consRate: 15.8, consUnit: "L/hr" },
  { code: "HEX-46",   type: "Case 220 Excavator",    project: "GB", days: 94.6,fuel: 1200, consRate: 11.5, consUnit: "L/hr" },
  { code: "PV-6889",  type: "Fuel Bowser",            project: "GB", days: 5,  fuel: 58.6, consRate: 14.1, consUnit: "km/L" },
];

async function main() {
  console.log("Starting project seed…\n");

  // ── 1. Upsert categories ────────────────────────────────────────────────────
  const catMap: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { code: c.code },
      update: { name: c.name, defaultMeterType: c.defaultMeterType, fleetGroup: c.fleetGroup },
      create: { code: c.code, name: c.name, defaultMeterType: c.defaultMeterType, fleetGroup: c.fleetGroup },
    });
    catMap[c.code] = cat.id;
  }
  console.log(`✓ ${CATEGORIES.length} categories ready`);

  // ── 2. Upsert projects ──────────────────────────────────────────────────────
  const projMap: Record<string, string> = {};
  for (const p of PROJECTS) {
    const proj = await prisma.project.upsert({
      where: { code: p.code },
      update: { name: p.name },
      create: { name: p.name, code: p.code },
    });
    projMap[p.code] = proj.id;
    console.log(`✓ Project: ${p.name} (${p.code})`);
  }

  // ── 3. Get/create a system user for audit logs ──────────────────────────────
  let sysUser = await prisma.user.findFirst({ where: { email: "system@edwardchristie.lk" } });
  if (!sysUser) {
    sysUser = await prisma.user.create({
      data: {
        name: "System Import",
        username: "system",
        email: "system@edwardchristie.lk",
        passwordHash: "n/a",
        role: "ADMIN",
      },
    });
  }

  // ── 4. Get a default fuel price ─────────────────────────────────────────────
  // We'll use 35000 cents (Rs. 350/L) as a default for diesel unless one exists
  const existingPrice = await prisma.fuelPrice.findFirst({ orderBy: { effectiveFrom: "desc" } });
  const fuelPriceCents = existingPrice?.pricePerLitre ?? 35000; // Rs 350/L

  // ── 5. Upsert assets + seed January 2026 data ──────────────────────────────
  const JAN_START = new Date("2026-01-01T00:00:00+05:30");

  // Remove duplicate placeholder
  const vehicles = VEHICLES.filter(v => v.code !== "LO-7181b");

  let assetCount = 0;
  let conditionCount = 0;
  let issueCount = 0;

  for (const v of vehicles) {
    const catCode = resolveCategory(v.type);
    const catId = catMap[catCode] ?? catMap["OTHER"];
    const meterType = meterTypeForCatCode(catCode);
    const projectId = projMap[v.project];

    const asset = await prisma.asset.upsert({
      where: { code: v.code },
      update: { projectId, categoryId: catId },
      create: {
        code: v.code,
        status: "ACTIVE",
        meterType,
        categoryId: catId,
        projectId,
      },
    });
    assetCount++;

    // Seed RentalRate with fuel consumption rates
    const basis = v.consUnit === "km/L" ? "km" : "hr";
    // Convert km/L consumption to L/km for hr basis, or store as-is for L/hr
    // fuelConsEcon/fuelConsTyp are stored as L/hr or L/km
    const consValue = v.consUnit === "km/L" ? 1 / v.consRate : v.consRate;
    if (v.consRate > 0) {
      await prisma.rentalRate.upsert({
        where: { assetId: asset.id },
        update: { fuelConsEcon: consValue, fuelConsTyp: consValue * 1.2, fuelConsBasis: basis },
        create: {
          assetId: asset.id,
          fuelConsEcon: consValue,
          fuelConsTyp: consValue * 1.2,
          fuelConsBasis: basis,
        },
      });
    }

    // Seed January 2026 working conditions (one WORKING entry per working day)
    if (v.days > 0) {
      const workingDays = Math.round(v.days); // for day-tracked; for hours just use 1 condition
      const isHourBased = !["TT", "PU", "FB"].includes(catCode);

      if (isHourBased) {
        // Log one WORKING condition for Jan (summary — hours tracked via meter readings)
        const condDate = new Date("2026-01-31T00:00:00+05:30");
        const existing = await prisma.dailyCondition.findFirst({
          where: { assetId: asset.id, logDate: condDate },
        });
        if (!existing) {
          await prisma.dailyCondition.create({
            data: {
              assetId: asset.id,
              logDate: condDate,
              status: "WORKING",
              note: `Jan 2026 import: ${v.days} machine hours`,
              recordedById: sysUser.id,
            },
          });
          conditionCount++;
        }
        // Log meter reading for hours
        if (v.days > 0) {
          const existingReading = await prisma.meterReading.findFirst({
            where: { assetId: asset.id, readingType: "HOURS" },
          });
          if (!existingReading) {
            await prisma.meterReading.create({
              data: {
                assetId: asset.id,
                readingType: "HOURS",
                value: v.days,
                readingDate: new Date("2026-01-31T23:59:59+05:30"),
                source: "MANUAL",
                recordedById: sysUser.id,
              },
            });
          }
        }
      } else {
        // Per-day tracked: log WORKING days spread across January
        for (let d = 0; d < workingDays; d++) {
          const dayOffset = Math.floor(d * (30 / workingDays));
          const condDate = new Date(JAN_START);
          condDate.setDate(condDate.getDate() + dayOffset);
          const existing = await prisma.dailyCondition.findFirst({
            where: { assetId: asset.id, logDate: condDate },
          });
          if (!existing) {
            await prisma.dailyCondition.create({
              data: {
                assetId: asset.id,
                logDate: condDate,
                status: "WORKING",
                note: "Jan 2026 import",
                recordedById: sysUser.id,
              },
            });
            conditionCount++;
          }
        }
      }
    }

    // Seed January 2026 fuel issue (one consolidated entry)
    if (v.fuel > 0) {
      const existingIssue = await prisma.fuelIssue.findFirst({
        where: { assetId: asset.id, issueDate: new Date("2026-01-31T00:00:00+05:30") },
      });
      if (!existingIssue) {
        await prisma.fuelIssue.create({
          data: {
            assetId: asset.id,
            fuelKind: "AUTO_DIESEL",
            litres: v.fuel,
            pricePerLitre: fuelPriceCents,
            totalCost: Math.round(v.fuel * fuelPriceCents),
            issueDate: new Date("2026-01-31T00:00:00+05:30"),
            source: "BULK_PUMP",
            issuedById: sysUser.id,
          },
        });
        issueCount++;
      }
    }
  }

  console.log(`\n✓ ${assetCount} vehicles upserted`);
  console.log(`✓ ${conditionCount} working-day conditions created`);
  console.log(`✓ ${issueCount} January fuel issues created`);
  console.log("\nDone! Projects:");
  for (const p of PROJECTS) {
    const count = vehicles.filter(v => v.project === p.code).length;
    console.log(`  ${p.name}: ${count} vehicles`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
