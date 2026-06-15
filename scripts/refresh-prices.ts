import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

// Load .env manually to ensure environment variables are present in script context
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

async function refreshPrices() {
  console.log("Starting Ceypetco historical fuel price refresh...");

  // Load admin user to associate with price entries
  const adminUser = await prisma.user.findFirst({
    where: { username: "admin" },
  });
  if (!adminUser) {
    console.error("Error: Seed admin user not found. Run seed script first.");
    process.exit(1);
  }

  const url = "https://ceypetco.gov.lk/historical-prices/";
  
  // Best-effort headers to avoid Cloudflare/WAF blocks
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://www.google.com/",
    "Cache-Control": "no-cache",
  };

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log("Ceypetco historical prices page loaded successfully. Parsing prices...");

    const parsedRevisions: { date: Date; dateStr: string; lad: number; lsd: number }[] = [];
    const rowRegex = /<tr>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>/g;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const dateStr = match[1].trim();
      const dateParts = dateStr.split(" ")[0].split(".");
      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1; // 0-based
        const year = parseInt(dateParts[2], 10);
        
        // Only process prices from January 2026 onwards
        if (year > 2026 || (year === 2026 && month >= 0)) {
          const lad = parseInt(match[4].trim(), 10) * 100; // to LKR cents
          const lsd = parseInt(match[5].trim(), 10) * 100; // to LKR cents
          
          if (!isNaN(day) && !isNaN(month) && !isNaN(year) && !isNaN(lad) && !isNaN(lsd)) {
            // Colombo midnight (UTC+5:30)
            const date = new Date(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`);
            parsedRevisions.push({ date, dateStr, lad, lsd });
          }
        }
      }
    }

    if (parsedRevisions.length === 0) {
      throw new Error("No price revisions found in the Ceypetco table since January 2026.");
    }

    console.log(`Parsed ${parsedRevisions.length} historical price revisions from January 2026 onwards.`);

    let changesRecorded = 0;

    for (const rev of parsedRevisions) {
      // Upsert Auto Diesel (LAD)
      const existingAuto = await prisma.fuelPrice.findUnique({
        where: {
          fuelKind_effectiveFrom: {
            fuelKind: "AUTO_DIESEL",
            effectiveFrom: rev.date,
          },
        },
      });

      if (!existingAuto || existingAuto.pricePerLitre !== rev.lad) {
        await prisma.fuelPrice.upsert({
          where: {
            fuelKind_effectiveFrom: {
              fuelKind: "AUTO_DIESEL",
              effectiveFrom: rev.date,
            },
          },
          update: {
            pricePerLitre: rev.lad,
            source: "CEYPETCO",
            enteredById: adminUser.id,
            note: `Auto-scraped from Ceypetco historical prices table (${rev.dateStr})`,
          },
          create: {
            fuelKind: "AUTO_DIESEL",
            pricePerLitre: rev.lad,
            effectiveFrom: rev.date,
            source: "CEYPETCO",
            enteredById: adminUser.id,
            note: `Auto-scraped from Ceypetco historical prices table (${rev.dateStr})`,
          },
        });
        changesRecorded++;
      }

      // Upsert Super Diesel (LSD)
      const existingSuper = await prisma.fuelPrice.findUnique({
        where: {
          fuelKind_effectiveFrom: {
            fuelKind: "SUPER_DIESEL",
            effectiveFrom: rev.date,
          },
        },
      });

      if (!existingSuper || existingSuper.pricePerLitre !== rev.lsd) {
        await prisma.fuelPrice.upsert({
          where: {
            fuelKind_effectiveFrom: {
              fuelKind: "SUPER_DIESEL",
              effectiveFrom: rev.date,
            },
          },
          update: {
            pricePerLitre: rev.lsd,
            source: "CEYPETCO",
            enteredById: adminUser.id,
            note: `Auto-scraped from Ceypetco historical prices table (${rev.dateStr})`,
          },
          create: {
            fuelKind: "SUPER_DIESEL",
            pricePerLitre: rev.lsd,
            effectiveFrom: rev.date,
            source: "CEYPETCO",
            enteredById: adminUser.id,
            note: `Auto-scraped from Ceypetco historical prices table (${rev.dateStr})`,
          },
        });
        changesRecorded++;
      }
    }

    // Log success in database AuditLog
    await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: "PRICE_REFRESH",
        entity: "FuelPrice",
        summary: `Automatically updated historical fuel prices from Ceypetco: parsed ${parsedRevisions.length} revisions starting Jan 2026; recorded ${changesRecorded} price updates.`,
      },
    });

    console.log(`Ceypetco historical prices updated successfully. Recorded ${changesRecorded} price updates.`);
  } catch (err: any) {
    console.warn("Failed to scrape Ceypetco website:", err.message);
    
    // Log graceful failure in the audit logs so administrators are notified
    await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: "PRICE_REFRESH",
        entity: "FuelPrice",
        summary: `Ceypetco historical prices scraper failed gracefully: ${err.message}. System continues to use existing prices.`,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

refreshPrices();
