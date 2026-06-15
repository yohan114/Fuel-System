import { prisma } from "../db";
import { getBillingConfig, minimumForMode } from "./config";
import { resolvePeriod, type BillingPeriod } from "./period";
import { computeRunningDelta, countWorkingDays, sumFuelForMonth } from "./usage";
import { pickRateCents, defaultModeForAsset } from "./rate";
import { computeTotals, unitLabel, basisLabel, type BillingMode, type RateBasis } from "./calc";

export type GenerateStatus =
  | "created"
  | "regenerated"
  | "skipped-finalized"
  | "skipped-existing"
  | "no-rate";

export interface GenerateOptions {
  year: number;
  month: number;
  assetIds?: string[];
  regenerate?: boolean;
  actorId?: string | null;
}

export interface AssetOutcome {
  assetId: string;
  assetCode: string;
  assetLabel?: string;
  status: GenerateStatus | "error";
  message?: string;
  billId?: string;
}

export interface GenerateResult {
  periodKey: string;
  created: number;
  regenerated: number;
  skippedFinalized: number;
  skippedExisting: number;
  noRate: number;
  errors: { assetId: string; assetCode?: string; message: string }[];
  assets: AssetOutcome[];
}

// Generates (or regenerates a DRAFT) bill for one asset for the given period.
export async function generateBillForAsset(
  assetId: string,
  period: BillingPeriod,
  opts: { regenerate: boolean; actorId?: string | null }
): Promise<{ status: GenerateStatus; billId?: string }> {
  const cfg = await getBillingConfig();

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { category: true, project: true, rentalRate: true },
  });
  if (!asset) throw new Error("Asset not found");
  if (!asset.rentalRate) return { status: "no-rate" };

  const existing = await prisma.bill.findUnique({
    where: { assetId_year_month: { assetId, year: period.year, month: period.month } },
  });

  if (existing && existing.status !== "DRAFT") {
    return { status: "skipped-finalized", billId: existing.id };
  }
  if (existing && !opts.regenerate) {
    return { status: "skipped-existing", billId: existing.id };
  }

  // Structural choices: preserve an admin's overrides on regenerate, else
  // derive sensible defaults from the asset.
  const billingMode: BillingMode = (existing?.billingMode as BillingMode) ||
    defaultModeForAsset(asset.meterType, asset.rentalRate.equipType);
  // Default to the Wet basis (machine + driver, no fuel baked into the rate);
  // the vehicle's actual monthly fuel total is billed as a separate line.
  const rateBasis: RateBasis = (existing?.rateBasis as RateBasis) || "w";
  const minimumUnits = existing ? existing.minimumUnits : minimumForMode(cfg, billingMode);

  const pickedRate = pickRateCents(asset.rentalRate, billingMode, rateBasis);
  const rateCents = pickedRate ?? 0;

  // Derive actual usage for the month.
  let openingMeter: number | null = null;
  let closingMeter: number | null = null;
  let actualUnits = 0;
  let derivedFromFuel = false;
  let fuelConsMidRate: number | null = null;

  // Count breakdown days in period (used for display + deduction)
  const breakdownDays = await prisma.dailyCondition.count({
    where: { assetId: asset.id, status: "BREAKDOWN", logDate: { gte: period.start, lte: period.end } },
  });

  if (billingMode === "hourly" || billingMode === "perkm") {
    const meterType = billingMode === "perkm" ? "KM" : "HOURS";
    const rd = await computeRunningDelta(asset.id, meterType, period.start, period.end);
    openingMeter = rd.opening;
    closingMeter = rd.closing;
    actualUnits = rd.delta;
  } else {
    actualUnits = await countWorkingDays(asset.id, period.start, period.end);
  }

  const fuel = await sumFuelForMonth(asset.id, period.start, period.end);

  // Fuel-based unit derivation: when no meter readings exist but fuel was issued
  // and a fuel consumption rate is available, derive units from litres / midCons.
  if (
    actualUnits === 0 &&
    fuel.litres > 0 &&
    (billingMode === "hourly" || billingMode === "perkm") &&
    asset.rentalRate.fuelConsEcon != null &&
    asset.rentalRate.fuelConsTyp != null
  ) {
    const midCons = (asset.rentalRate.fuelConsEcon + asset.rentalRate.fuelConsTyp) / 2;
    if (midCons > 0) {
      actualUnits = fuel.litres / midCons;
      fuelConsMidRate = midCons;
      derivedFromFuel = true;
    }
  }

  // Breakdown deduction for hourly/perkm: estimate units lost during breakdown days.
  let breakdownDeductCents = 0;
  if (breakdownDays > 0 && (billingMode === "hourly" || billingMode === "perkm")) {
    const workingDays = await countWorkingDays(asset.id, period.start, period.end);
    const totalDays = workingDays + breakdownDays;
    if (totalDays > 0 && actualUnits > 0) {
      const unitsPerDay = actualUnits / totalDays;
      const deductUnits = unitsPerDay * breakdownDays;
      breakdownDeductCents = Math.round(deductUnits * rateCents);
    }
  }

  const totals = computeTotals({
    billingMode,
    rateBasis,
    rateCents,
    actualUnits,
    minimumUnits,
    fuelLitres: fuel.litres,
    fuelCostCents: fuel.costCents,
    ssclRate: cfg.ssclRate,
    vatRate: cfg.vatRate,
  });

  const unit = unitLabel(billingMode);
  const assetLabel =
    [asset.brand, asset.model].filter(Boolean).join(" ").trim() || asset.category.name;

  // Line items: rental always, fuel only when actually charged (fw + litres),
  // breakdown deduction as ADJUSTMENT when applicable.
  const lineItems: {
    kind: string;
    description: string;
    quantity: number;
    unit: string;
    unitRateCents: number;
    amountCents: number;
  }[] = [
    {
      kind: "RENTAL",
      description: pickedRate == null
        ? `Machine rental (no rate card tier for ${billingMode}/${rateBasis})`
        : `Machine rental — ${billingMode} (${rateBasis.toUpperCase()})${derivedFromFuel ? " [units from fuel]" : ""}`,
      quantity: totals.billableUnits,
      unit,
      unitRateCents: rateCents,
      amountCents: totals.rentalAmountCents,
    },
  ];
  if (totals.fuelChargedCents > 0) {
    const avgPerL = fuel.litres > 0 ? Math.round(fuel.costCents / fuel.litres) : 0;
    lineItems.push({
      kind: "FUEL",
      description: `Fuel issued — monthly total, all sites (${basisLabel(rateBasis)})`,
      quantity: fuel.litres,
      unit: "L",
      unitRateCents: avgPerL,
      amountCents: totals.fuelChargedCents,
    });
  }
  if (breakdownDeductCents > 0) {
    lineItems.push({
      kind: "ADJUSTMENT",
      description: `Breakdown deduction (${breakdownDays} day${breakdownDays !== 1 ? "s" : ""} out of service)`,
      quantity: breakdownDays,
      unit: "day",
      unitRateCents: 0,
      amountCents: -breakdownDeductCents,
    });
  }

  const data = {
    year: period.year,
    month: period.month,
    periodKey: period.periodKey,
    periodStart: period.start,
    periodEnd: period.end,
    assetId: asset.id,
    assetCode: asset.code,
    assetRegNo: asset.regNo,
    assetLabel,
    projectId: asset.projectId,
    projectName: asset.project ? asset.project.name : null,
    projectCode: asset.project ? asset.project.code : null,
    billingMode,
    rateBasis,
    rateCents,
    openingMeter,
    closingMeter,
    actualUnits,
    minimumUnits,
    billableUnits: totals.billableUnits,
    rentalAmountCents: totals.rentalAmountCents,
    fuelLitres: fuel.litres,
    fuelCostCents: fuel.costCents,
    subtotalCents: totals.subtotalCents,
    ssclRate: cfg.ssclRate,
    ssclCents: totals.ssclCents,
    vatRate: cfg.vatRate,
    vatCents: totals.vatCents,
    grandTotalCents: totals.grandTotalCents,
    generatedById: opts.actorId ?? null,
    derivedFromFuel,
    fuelConsMidRate,
    breakdownDays,
    breakdownDeductCents,
  };

  const billId = await prisma.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      await tx.billLineItem.deleteMany({ where: { billId: existing.id } });
      await tx.bill.update({
        where: { id: existing.id },
        data: { ...data, lineItems: { create: lineItems } },
      });
      id = existing.id;
    } else {
      const created = await tx.bill.create({
        data: { ...data, lineItems: { create: lineItems } },
      });
      id = created.id;
    }
    await tx.auditLog.create({
      data: {
        actorId: opts.actorId ?? null,
        action: existing ? "UPDATE" : "CREATE",
        entity: "Bill",
        entityId: id,
        summary: `${existing ? "Regenerated" : "Generated"} bill ${period.periodKey} for ${asset.code}: grand Rs. ${(totals.grandTotalCents / 100).toLocaleString("en-LK")}`,
      },
    });
    return id;
  });

  return { status: existing ? "regenerated" : "created", billId };
}

// Generates bills for every eligible asset (active + has a rate card) for the
// given month. Runs sequentially to avoid SQLite write contention.
export async function generateBillsForMonth(opts: GenerateOptions): Promise<GenerateResult> {
  const period = resolvePeriod(opts.year, opts.month);
  const result: GenerateResult = {
    periodKey: period.periodKey,
    created: 0,
    regenerated: 0,
    skippedFinalized: 0,
    skippedExisting: 0,
    noRate: 0,
    errors: [],
    assets: [],
  };

  const assets = await prisma.asset.findMany({
    where: {
      status: { not: "DISPOSED" },
      rentalRate: { isNot: null },
      ...(opts.assetIds ? { id: { in: opts.assetIds } } : {}),
    },
    select: { id: true, code: true, brand: true, model: true, regNo: true, category: { select: { name: true } } },
    orderBy: { code: "asc" },
  });

  for (const a of assets) {
    const assetLabel = [a.brand, a.model].filter(Boolean).join(" ").trim() || a.category.name;
    try {
      const r = await generateBillForAsset(a.id, period, {
        regenerate: opts.regenerate ?? false,
        actorId: opts.actorId,
      });
      if (r.status === "created") result.created++;
      else if (r.status === "regenerated") result.regenerated++;
      else if (r.status === "skipped-finalized") result.skippedFinalized++;
      else if (r.status === "skipped-existing") result.skippedExisting++;
      else if (r.status === "no-rate") result.noRate++;
      result.assets.push({ assetId: a.id, assetCode: a.code, assetLabel, status: r.status, billId: r.billId });
    } catch (err: any) {
      result.errors.push({ assetId: a.id, assetCode: a.code, message: err?.message || "error" });
      result.assets.push({ assetId: a.id, assetCode: a.code, assetLabel, status: "error", message: err?.message || "error" });
    }
  }

  return result;
}

// Flips ISSUED bills whose dueDate has passed to OVERDUE. Returns the count.
export async function sweepOverdueBills(now: Date = new Date()): Promise<number> {
  const res = await prisma.bill.updateMany({
    where: { status: "ISSUED", dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });
  return res.count;
}
