import { prisma } from "../db";

// Per-asset monthly usage derivation. The running-delta logic mirrors
// src/lib/reports/aggregate.ts:148-192 but is scoped to a single asset (no
// aggregation, no N+1 over many assets).

export interface RunningDelta {
  opening: number | null;
  closing: number | null;
  delta: number;
}

// Cumulative meter growth within [start, end] for a given meter type.
// Opening = last reading on/before the period start (anchor), falling back to
// the earliest reading inside the window. Closing = last reading on/before the
// period end. Delta is clamped to 0 when there is no forward growth (guards
// against odometer resets / back-dated corrections).
export async function computeRunningDelta(
  assetId: string,
  meterType: "KM" | "HOURS",
  start: Date,
  end: Date
): Promise<RunningDelta> {
  const opening =
    (await prisma.meterReading.findFirst({
      where: { assetId, readingType: meterType, readingDate: { lte: start } },
      orderBy: [{ value: "desc" }, { readingDate: "desc" }],
    })) ||
    (await prisma.meterReading.findFirst({
      where: { assetId, readingType: meterType, readingDate: { gte: start, lte: end } },
      orderBy: [{ value: "asc" }, { readingDate: "asc" }],
    }));

  const closing = await prisma.meterReading.findFirst({
    where: { assetId, readingType: meterType, readingDate: { lte: end } },
    orderBy: [{ value: "desc" }, { readingDate: "desc" }],
  });

  let delta = 0;
  if (opening && closing && closing.value > opening.value) {
    delta = closing.value - opening.value;
  }

  return {
    opening: opening ? opening.value : null,
    closing: closing ? closing.value : null,
    delta,
  };
}

// Number of days the asset was logged as WORKING within the period.
export async function countWorkingDays(
  assetId: string,
  start: Date,
  end: Date
): Promise<number> {
  return prisma.dailyCondition.count({
    where: { assetId, status: "WORKING", logDate: { gte: start, lte: end } },
  });
}

export interface FuelSummary {
  litres: number;
  costCents: number;
  count: number;
}

// Total fuel issued + cost for the asset in the period. costCents comes straight
// from the priced FuelIssue snapshots, so no re-pricing is required.
export async function sumFuelForMonth(
  assetId: string,
  start: Date,
  end: Date
): Promise<FuelSummary> {
  const agg = await prisma.fuelIssue.aggregate({
    where: { assetId, issueDate: { gte: start, lte: end } },
    _sum: { litres: true, totalCost: true },
    _count: true,
  });
  return {
    litres: agg._sum.litres ?? 0,
    costCents: agg._sum.totalCost ?? 0,
    count: agg._count ?? 0,
  };
}
