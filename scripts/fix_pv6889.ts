import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Find DC category
  const dc = await prisma.category.findUnique({ where: { code: "DC" } });
  if (!dc) throw new Error("DC category not found");

  // 2. Fix SC-05 / PV-6889
  const asset = await prisma.asset.findFirst({ where: { regNo: "PV-6889" } });
  if (!asset) { console.log("Asset PV-6889 not found"); }
  else {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { categoryId: dc.id, meterType: "KM", typeLabel: "Double Cab" },
    });
    console.log(`Updated ${asset.code} (PV-6889): category=DC, meterType=KM, typeLabel=Double Cab`);

    // Check its rate card
    const rate = await prisma.rentalRate.findUnique({ where: { assetId: asset.id } });
    if (rate) {
      console.log(`Rate card: kmFwCents=${rate.kmFwCents} kmWCents=${rate.kmWCents} kmDCents=${rate.kmDCents}`);
    } else {
      console.log("No rate card for this asset.");
    }
  }

  // 3. Set billing.minKm = 3000
  await prisma.setting.upsert({
    where: { key: "billing.minKm" },
    update: { value: "3000" },
    create: { key: "billing.minKm", value: "3000", description: "Minimum km per month for KM-billed vehicles" },
  });
  console.log("Set billing.minKm = 3000");

  // 4. Summary of KM-metered assets with/without km rates
  const kmAssets = await prisma.asset.findMany({
    where: { meterType: "KM", status: { not: "DISPOSED" } },
    include: { rentalRate: true },
  });
  const withRate = kmAssets.filter(a => a.rentalRate?.kmWCents != null);
  const withoutRate = kmAssets.filter(a => !a.rentalRate?.kmWCents);
  console.log(`\nKM-metered assets: ${kmAssets.length} total`);
  console.log(`  With kmWCents: ${withRate.length}`);
  console.log(`  Without kmWCents: ${withoutRate.length}`);
  if (withoutRate.length > 0 && withoutRate.length <= 20) {
    console.log("  Missing km rate:", withoutRate.map(a => a.code).join(", "));
  }
  console.log("\nSample km rates (first 10 with rate):");
  for (const a of withRate.slice(0, 10)) {
    console.log(`  ${a.code.padEnd(10)} kmW=Rs${((a.rentalRate!.kmWCents||0)/100).toFixed(2)}/km`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
