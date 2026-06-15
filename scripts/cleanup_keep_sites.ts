/**
 * Cleanup: keep only the active project sites and remove all others.
 *
 * Final site set kept:
 *   - Badalgama Plant      (matched by name containing "Badalgama")
 *   - CEP-03 ABC           (code CEP-ABC)
 *   - CEP-03 E             (code CEP-E)
 *   - Gampaha Bridge       (code GB)
 *
 * For every OTHER project: its users, assets and bulk tanks are released
 * (projectId set to null — they revert to the global/unassigned pool, NOT
 * deleted), then the project itself is deleted. Bills snapshot their project
 * details so existing invoices are unaffected.
 *
 * Idempotent & safe: run as many times as needed.
 *
 * Run: npx tsx scripts/cleanup_keep_sites.ts
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

// Codes that are always kept.
const KEEP_CODES = new Set(["CEP-ABC", "CEP-E", "GB"]);
// Name fragments (case-insensitive) that are always kept.
const KEEP_NAME_FRAGMENTS = ["badalgama"];

function isKept(p: { code: string; name: string }): boolean {
  if (KEEP_CODES.has(p.code)) return true;
  const lname = p.name.toLowerCase();
  return KEEP_NAME_FRAGMENTS.some((f) => lname.includes(f));
}

async function main() {
  console.log("Cleaning up project sites…\n");

  const projects = await prisma.project.findMany({
    include: { _count: { select: { users: true, assets: true } } },
    orderBy: { name: "asc" },
  });

  const kept = projects.filter(isKept);
  const toRemove = projects.filter((p) => !isKept(p));

  console.log("Keeping:");
  kept.forEach((p) => console.log(`  ✓ ${p.name} (${p.code}) — ${p._count.assets} assets`));

  if (toRemove.length === 0) {
    console.log("\nNo other sites to remove. Done.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nRemoving (vehicles released to unassigned pool):");
  let releasedAssets = 0;
  let releasedUsers = 0;

  for (const p of toRemove) {
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.updateMany({ where: { projectId: p.id }, data: { projectId: null } });
      const a = await tx.asset.updateMany({ where: { projectId: p.id }, data: { projectId: null } });
      await tx.bulkTank.updateMany({ where: { projectId: p.id }, data: { projectId: null } });
      await tx.project.delete({ where: { id: p.id } });
      releasedAssets += a.count;
      releasedUsers += u.count;
      console.log(`  ✗ ${p.name} (${p.code}) — released ${a.count} assets, ${u.count} users`);
    });

    await prisma.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Project",
        entityId: p.id,
        summary: `Cleanup: removed site "${p.name}" (${p.code}); assets/users released to unassigned pool`,
      },
    });
  }

  console.log(`\nDone. Removed ${toRemove.length} sites; released ${releasedAssets} assets and ${releasedUsers} users.`);
  console.log(`Sites remaining: ${kept.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
