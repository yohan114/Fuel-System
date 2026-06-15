import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "file:./data/app.db" });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const dcDups: any[] = await prisma.$queryRaw`
    SELECT assetId, logDate, COUNT(*) as cnt
    FROM DailyCondition GROUP BY assetId, logDate HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 10
  `;
  console.log("DailyCondition dup groups:", dcDups.length);
  if (dcDups.length) console.log(JSON.stringify(dcDups.slice(0,3)));

  const mrDups: any[] = await prisma.$queryRaw`
    SELECT assetId, readingDate, readingType, source, COUNT(*) as cnt
    FROM MeterReading GROUP BY assetId, readingDate, readingType, source HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 10
  `;
  console.log("MeterReading dup groups:", mrDups.length);
  if (mrDups.length) console.log(JSON.stringify(mrDups.slice(0,3)));

  const fiDups: any[] = await prisma.$queryRaw`
    SELECT assetId, issueDate, litres, source, COUNT(*) as cnt
    FROM FuelIssue GROUP BY assetId, issueDate, litres, source HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 20
  `;
  console.log("FuelIssue dup groups:", fiDups.length);
  if (fiDups.length) console.log(JSON.stringify(fiDups.slice(0,5)));

  const billDups: any[] = await prisma.$queryRaw`
    SELECT assetId, year, month, COUNT(*) as cnt
    FROM Bill GROUP BY assetId, year, month HAVING COUNT(*) > 1 LIMIT 10
  `;
  console.log("Bill dup groups:", billDups.length);

  const [dc, mr, fi, b] = await Promise.all([
    prisma.dailyCondition.count(),
    prisma.meterReading.count(),
    prisma.fuelIssue.count(),
    prisma.bill.count(),
  ]);
  console.log(`Totals — DailyCondition:${dc} MeterReading:${mr} FuelIssue:${fi} Bill:${b}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
