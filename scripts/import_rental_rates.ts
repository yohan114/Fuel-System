/**
 * Import machine rental rate cards into the RentalRate table.
 *
 * Source: scripts/data/rate_cards.json — { fleet: FLEET_MACHINES[], portable: PORTABLE_EQUIPMENT[] }
 * extracted once from the E&C "Machine Rental & Timesheet Calculator" HTML.
 *
 * To regenerate scripts/data/rate_cards.json from a new copy of the HTML, pull
 * the `const FLEET_MACHINES = [...]` and `const PORTABLE_EQUIPMENT = [...]`
 * arrays and write them under { fleet, portable }.
 *
 * Source rates are whole LKR and are converted to cents (× 100) here. Assets are
 * matched by code (=ec) then regNo (=reg); unmatched cards are reported, not
 * auto-created.
 *
 * Run: npx tsx scripts/import_rental_rates.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import fs from "fs";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        process.env[key] = value.trim();
      }
    }
  }
}
loadEnv();

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

type Tier = { fw?: number | null; w?: number | null; d?: number | null } | null;
interface FleetMachine {
  id: number;
  label: string;
  cat: string;
  reg?: string;
  ec?: string;
  model?: string;
  year?: string;
  km?: number;
  fuel?: number;
  op?: number;
  r: { h: Tier; dy: Tier; km: Tier };
}
interface Portable {
  id: number;
  cat: string;
  cap?: string;
  label: string;
  dw?: number | null;
  dd?: number | null;
}

function toCents(v: number | null | undefined): number | null {
  if (v == null || isNaN(v)) return null;
  return Math.round(v * 100);
}

function tierCents(t: Tier) {
  return {
    fw: toCents(t?.fw ?? null),
    w: toCents(t?.w ?? null),
    d: toCents(t?.d ?? null),
  };
}

async function findAsset(ec?: string, reg?: string) {
  const code = ec?.trim().toUpperCase();
  if (code) {
    const byCode = await prisma.asset.findUnique({ where: { code } });
    if (byCode) return byCode;
  }
  const regNo = reg?.trim().toUpperCase();
  if (regNo) {
    const byReg = await prisma.asset.findFirst({ where: { regNo } });
    if (byReg) return byReg;
  }
  return null;
}

async function main() {
  const dataPath = path.join(process.cwd(), "scripts", "data", "rate_cards.json");
  if (!fs.existsSync(dataPath)) {
    console.error(`Rate card data not found at ${dataPath}`);
    process.exit(1);
  }
  const { fleet, portable } = JSON.parse(fs.readFileSync(dataPath, "utf8")) as {
    fleet: FleetMachine[];
    portable: Portable[];
  };

  console.log(`Loaded ${fleet.length} fleet machines, ${portable.length} portable items.`);

  let matched = 0;
  let portableMatched = 0;
  const unmatched: { ec?: string; reg?: string; label: string; type: string }[] = [];

  for (const m of fleet) {
    const asset = await findAsset(m.ec, m.reg);
    if (!asset) {
      unmatched.push({ ec: m.ec, reg: m.reg, label: m.label, type: "FLEET" });
      continue;
    }
    const h = tierCents(m.r?.h ?? null);
    const dy = tierCents(m.r?.dy ?? null);
    const km = tierCents(m.r?.km ?? null);
    await prisma.rentalRate.upsert({
      where: { assetId: asset.id },
      update: {
        sourceLabel: m.label,
        category: m.cat,
        equipType: "FLEET",
        fuelQtyDefault: m.fuel ?? null,
        opRate: toCents(m.op ?? null),
        hrFwCents: h.fw, hrWCents: h.w, hrDCents: h.d,
        dyFwCents: dy.fw, dyWCents: dy.w, dyDCents: dy.d,
        kmFwCents: km.fw, kmWCents: km.w, kmDCents: km.d,
        portDwCents: null, portDdCents: null,
      },
      create: {
        assetId: asset.id,
        sourceLabel: m.label,
        category: m.cat,
        equipType: "FLEET",
        fuelQtyDefault: m.fuel ?? null,
        opRate: toCents(m.op ?? null),
        hrFwCents: h.fw, hrWCents: h.w, hrDCents: h.d,
        dyFwCents: dy.fw, dyWCents: dy.w, dyDCents: dy.d,
        kmFwCents: km.fw, kmWCents: km.w, kmDCents: km.d,
      },
    });
    matched++;
  }

  // Portable equipment carries no E&C code/reg, so it only matches if an asset
  // was deliberately created for it. Otherwise it is reported for reconciliation.
  for (const p of portable) {
    const asset = await findAsset(undefined, undefined);
    if (!asset) {
      unmatched.push({ label: p.label, type: "PORTABLE" });
      continue;
    }
    await prisma.rentalRate.upsert({
      where: { assetId: asset.id },
      update: {
        sourceLabel: p.label,
        category: p.cat,
        equipType: "PORTABLE",
        portDwCents: toCents(p.dw ?? null),
        portDdCents: toCents(p.dd ?? null),
      },
      create: {
        assetId: asset.id,
        sourceLabel: p.label,
        category: p.cat,
        equipType: "PORTABLE",
        portDwCents: toCents(p.dw ?? null),
        portDdCents: toCents(p.dd ?? null),
      },
    });
    portableMatched++;
  }

  const admin = await prisma.user.findFirst({ where: { username: "admin" } });
  await prisma.auditLog.create({
    data: {
      actorId: admin?.id ?? null,
      action: "UPDATE",
      entity: "RentalRate",
      summary: `Imported rate cards: ${matched} fleet matched, ${portableMatched} portable matched, ${unmatched.length} unmatched.`,
    },
  });

  console.log("\n========== Rate Card Import Summary ==========");
  console.log(`Fleet matched & upserted:    ${matched}`);
  console.log(`Portable matched & upserted: ${portableMatched}`);
  console.log(`Unmatched (reported only):   ${unmatched.length}`);
  if (unmatched.length) {
    console.log("\n-- Unmatched cards (no asset by code/regNo; not auto-created) --");
    for (const u of unmatched.slice(0, 50)) {
      console.log(`  [${u.type}] ec=${u.ec ?? "—"} reg=${u.reg ?? "—"} ${u.label}`);
    }
    if (unmatched.length > 50) console.log(`  …and ${unmatched.length - 50} more.`);
  }
  console.log("=============================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
