import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m) {
        let v = m[2] || "";
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        process.env[m[1]] = v.trim();
      }
    }
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const SHEETS = [
  { name: "January 2026", year: 2026, month: 1, day: 31 },
  { name: "February 2026 ", year: 2026, month: 2, day: 28 }, // note trailing space
  { name: "March 2026", year: 2026, month: 3, day: 31 }
];

async function main() {
  console.log("Starting Gampaha Bridge data import...");

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    console.error("Admin user not found");
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), "machines, Vehicles at Gampaha Bridge - 2.xlsb");
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);

  for (const s of SHEETS) {
    const sheet = workbook.Sheets[s.name];
    if (!sheet) {
      console.warn(`Sheet not found: ${s.name}`);
      continue;
    }

    console.log(`\nProcessing Gampaha Bridge sheet: ${s.name}`);
    const json = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
    
    // Rows index 3 and onward are data. Skip summary rows at the end.
    for (let r = 3; r < json.length; r++) {
      const row = json[r];
      if (!row || !row[1]) continue;

      const vehicleNo = String(row[1]).trim().toUpperCase();
      if (vehicleNo.toLowerCase().includes("total") || vehicleNo === "") continue;

      const hours = typeof row[3] === "number" ? row[3] : 0;
      const fuel = typeof row[6] === "number" ? row[6] : 0;

      // Find asset
      const asset = await prisma.asset.findFirst({
        where: {
          OR: [
            { code: vehicleNo },
            { regNo: vehicleNo }
          ]
        }
      });

      if (!asset) {
        console.warn(`  Asset not found in DB: ${vehicleNo}`);
        continue;
      }

      const issueDate = new Date(`${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}T08:00:00.000Z`);

      // 1. Import fuel dispatches
      if (fuel > 0) {
        // Resolve price
        const fuelPrice = await prisma.fuelPrice.findFirst({
          where: {
            fuelKind: "AUTO_DIESEL",
            effectiveFrom: { lte: issueDate }
          },
          orderBy: { effectiveFrom: "desc" }
        });

        if (!fuelPrice) {
          console.error(`  Could not resolve fuel price for ${issueDate.toISOString()}`);
          continue;
        }

        const existingIssue = await prisma.fuelIssue.findFirst({
          where: {
            assetId: asset.id,
            litres: fuel,
            issueDate: issueDate
          }
        });

        if (existingIssue) {
          console.log(`  [Fuel] Already exists for ${asset.code} on ${s.name}: ${fuel} L`);
        } else {
          const totalCost = Math.round(fuel * fuelPrice.pricePerLitre);
          await prisma.fuelIssue.create({
            data: {
              assetId: asset.id,
              fuelKind: "AUTO_DIESEL",
              litres: fuel,
              pricePerLitre: fuelPrice.pricePerLitre,
              totalCost: totalCost,
              source: "Gampaha Bridge Sheet",
              issueDate: issueDate,
              issuedById: admin.id,
              fuelPriceId: fuelPrice.id
            }
          });
          console.log(`  [Fuel] Imported for ${asset.code} on ${s.name}: ${fuel} L`);
        }
      }

      // 2. Import working hours
      if (hours > 0 && asset.meterType === "HOURS") {
        const existingReading = await prisma.meterReading.findFirst({
          where: {
            assetId: asset.id,
            readingType: "HOURS",
            readingDate: issueDate
          }
        });

        if (existingReading) {
          console.log(`  [Reading] Already exists for ${asset.code} on ${s.name}: ${hours} hrs`);
        } else {
          await prisma.meterReading.create({
            data: {
              assetId: asset.id,
              readingType: "HOURS",
              value: hours,
              readingDate: issueDate,
              source: "MANUAL",
              recordedById: admin.id
            }
          });
          console.log(`  [Reading] Imported for ${asset.code} on ${s.name}: ${hours} hrs`);
        }
      }
    }
  }

  console.log("\nGampaha Bridge import finished.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
