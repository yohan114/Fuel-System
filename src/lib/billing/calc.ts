// Pure billing math — no DB access, fully unit-testable. Replicates the
// E&C Machine Rental Calculator exactly: billable = max(actual, minimum);
// fuel is charged only on the Fully Wet (fw) basis; SSCL applies to the
// subtotal and VAT applies to (subtotal + SSCL). All money is LKR cents.

export type BillingMode = "hourly" | "perkm" | "perday";
export type RateBasis = "fw" | "w" | "d";

export interface LineComputation {
  billingMode: BillingMode;
  rateBasis: RateBasis;
  rateCents: number;
  actualUnits: number;
  minimumUnits: number;
  fuelLitres: number;
  fuelCostCents: number;
  ssclRate: number;
  vatRate: number;
}

export interface ComputedTotals {
  billableUnits: number;
  rentalAmountCents: number;
  fuelChargedCents: number; // fuelCostCents when basis === 'fw', else 0
  subtotalCents: number;
  ssclCents: number;
  vatCents: number;
  grandTotalCents: number;
}

export function computeTotals(i: LineComputation): ComputedTotals {
  const billableUnits = Math.max(i.actualUnits, i.minimumUnits);
  const rentalAmountCents = Math.round(billableUnits * i.rateCents);

  // E&C supplies fuel only on the Fully Wet basis; otherwise the customer fuels
  // their own machine, so fuel is not billed.
  const fuelChargedCents = i.rateBasis === "fw" ? i.fuelCostCents : 0;

  const subtotalCents = rentalAmountCents + fuelChargedCents;
  const ssclCents = Math.round(subtotalCents * i.ssclRate);
  const preVatCents = subtotalCents + ssclCents;
  const vatCents = Math.round(preVatCents * i.vatRate);
  const grandTotalCents = preVatCents + vatCents;

  return {
    billableUnits,
    rentalAmountCents,
    fuelChargedCents,
    subtotalCents,
    ssclCents,
    vatCents,
    grandTotalCents,
  };
}

// Display helpers (LKR).
export function centsToLkr(cents: number): number {
  return cents / 100;
}

export function unitLabel(mode: BillingMode): "hr" | "km" | "day" {
  return mode === "perkm" ? "km" : mode === "perday" ? "day" : "hr";
}

export function basisLabel(basis: RateBasis): string {
  return basis === "fw" ? "Fully Wet" : basis === "w" ? "Wet" : "Dry";
}

export function modeLabel(mode: BillingMode): string {
  return mode === "perkm" ? "Per-KM" : mode === "perday" ? "Per-Day" : "Hourly";
}
