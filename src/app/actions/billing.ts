"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { getBillingConfig } from "@/lib/billing/config";
import { resolvePeriod } from "@/lib/billing/period";
import {
  generateBillsForMonth,
  generateBillForAsset,
  sweepOverdueBills,
} from "@/lib/billing/generate";

const MODES = ["hourly", "perkm", "perday"];
const BASES = ["fw", "w", "d"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Generate (or regenerate) all bills for a month.
export async function generateBillsForMonthAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to generate bills" };
  }

  const year = parseInt(formData.get("year")?.toString() || "", 10);
  const month = parseInt(formData.get("month")?.toString() || "", 10);
  const regenerate = formData.get("regenerate") === "true" || formData.get("regenerate") === "on";

  if (!year || !month || month < 1 || month > 12) {
    return { error: "A valid year and month are required" };
  }

  try {
    const result = await generateBillsForMonth({ year, month, regenerate, actorId: admin.id });
    revalidatePath("/billing");
    return { success: true, result };
  } catch (err: any) {
    console.error("Generate bills error:", err);
    return { error: err.message || "Failed to generate bills" };
  }
}

// Regenerate a single DRAFT bill from the latest rate card + data.
export async function regenerateBillAction(billId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to regenerate bills" };
  }

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status !== "DRAFT") return { error: "Cannot regenerate a finalized invoice" };

    const period = resolvePeriod(bill.year, bill.month);
    await generateBillForAsset(bill.assetId, period, { regenerate: true, actorId: admin.id });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Regenerate bill error:", err);
    return { error: err.message || "Failed to regenerate bill" };
  }
}

// Edit a DRAFT bill's billing mode / basis / minimum / notes, then recompute.
export async function updateBillDraftAction(billId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit bills" };
  }

  const billingMode = formData.get("billingMode")?.toString() || "";
  const rateBasis = formData.get("rateBasis")?.toString() || "";
  const minStr = formData.get("minimumUnits")?.toString() || "";
  const notes = formData.get("notes")?.toString().trim() || null;

  if (!MODES.includes(billingMode)) return { error: "Invalid billing mode" };
  if (!BASES.includes(rateBasis)) return { error: "Invalid rate basis" };
  const minimumUnits = parseFloat(minStr);
  if (isNaN(minimumUnits) || minimumUnits < 0) return { error: "Minimum units must be zero or greater" };

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status !== "DRAFT") return { error: "Only draft bills can be edited" };

    // Persist the structural choices, then recompute (regenerate reads them back
    // and re-derives rate / usage / fuel / totals). notes are preserved.
    await prisma.bill.update({
      where: { id: billId },
      data: { billingMode, rateBasis, minimumUnits, notes },
    });

    const period = resolvePeriod(bill.year, bill.month);
    await generateBillForAsset(bill.assetId, period, { regenerate: true, actorId: admin.id });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Update bill draft error:", err);
    return { error: err.message || "Failed to update bill" };
  }
}

// Finalize a DRAFT into an ISSUED invoice with a unique invoice number + due date.
export async function finalizeBillAction(billId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to issue invoices" };
  }

  try {
    const cfg = await getBillingConfig();
    const invoiceNumber = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new Error("Bill not found");
      if (bill.status !== "DRAFT") throw new Error("Only draft bills can be issued");

      const issuedCount = await tx.bill.count({
        where: { year: bill.year, month: bill.month, invoiceNumber: { not: null } },
      });
      const seq = String(issuedCount + 1).padStart(4, "0");
      const number = `${cfg.invoicePrefix}-${bill.year}-${pad2(bill.month)}-${seq}`;

      const issuedDate = new Date();
      const dueDate = new Date(issuedDate.getTime() + cfg.dueDays * 24 * 60 * 60 * 1000);

      await tx.bill.update({
        where: { id: billId },
        data: { status: "ISSUED", invoiceNumber: number, issuedDate, dueDate },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entity: "Bill",
          entityId: billId,
          summary: `Issued invoice ${number} for ${bill.assetCode} (${bill.periodKey})`,
        },
      });
      return number;
    });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true, invoiceNumber };
  } catch (err: any) {
    console.error("Finalize bill error:", err);
    return { error: err.message || "Failed to issue invoice" };
  }
}

// Record payment against an ISSUED / OVERDUE invoice.
export async function markBillPaidAction(billId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to record payments" };
  }

  const paidLkrStr = formData.get("paidLkr")?.toString() || "";
  const paymentRef = formData.get("paymentRef")?.toString().trim() || null;
  const paymentNote = formData.get("paymentNote")?.toString().trim() || null;
  const paidDateStr = formData.get("paidDate")?.toString() || "";

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status !== "ISSUED" && bill.status !== "OVERDUE") {
      return { error: "Only issued invoices can be marked as paid" };
    }

    // Default the paid amount to the grand total when not supplied.
    const paidAmountCents = paidLkrStr
      ? Math.round(parseFloat(paidLkrStr) * 100)
      : bill.grandTotalCents;
    if (isNaN(paidAmountCents) || paidAmountCents < 0) {
      return { error: "Paid amount must be a valid number" };
    }
    const paidDate = paidDateStr ? new Date(paidDateStr) : new Date();

    await prisma.bill.update({
      where: { id: billId },
      data: { status: "PAID", paidDate, paidAmountCents, paymentRef, paymentNote },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Bill",
        entityId: billId,
        summary: `Recorded payment for ${bill.invoiceNumber || bill.assetCode}: Rs. ${(paidAmountCents / 100).toLocaleString("en-LK")}`,
      },
    });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Mark bill paid error:", err);
    return { error: err.message || "Failed to record payment" };
  }
}

// Sweep ISSUED bills past their due date to OVERDUE.
export async function markOverdueAction() {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to perform this action" };
  }
  try {
    const count = await sweepOverdueBills();
    revalidatePath("/billing");
    return { success: true, count };
  } catch (err: any) {
    console.error("Mark overdue error:", err);
    return { error: err.message || "Failed to update overdue invoices" };
  }
}

// Update billing.* settings from the admin billing console.
export async function updateBillingSettingsAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to update billing settings" };
  }

  const enabled = formData.get("enabled") === "true" || formData.get("enabled") === "on" ? "true" : "false";
  const cron = formData.get("cron")?.toString().trim() || "0 3 1 * *";
  const minHours = formData.get("minHours")?.toString().trim() || "120";
  const minKm = formData.get("minKm")?.toString().trim() || "0";
  const minDays = formData.get("minDays")?.toString().trim() || "26";
  const ssclPct = formData.get("ssclPct")?.toString().trim();
  const vatPct = formData.get("vatPct")?.toString().trim();
  const dueDays = formData.get("dueDays")?.toString().trim() || "30";
  const invoicePrefix = formData.get("invoicePrefix")?.toString().trim() || "EC-INV";

  // Tax fields are entered as percentages in the UI; stored as fractions.
  const ssclRate = ssclPct ? (parseFloat(ssclPct) / 100).toString() : "0.025";
  const vatRate = vatPct ? (parseFloat(vatPct) / 100).toString() : "0.18";

  const entries: { key: string; value: string }[] = [
    { key: "billing.enabled", value: enabled },
    { key: "billing.cron", value: cron },
    { key: "billing.minHours", value: minHours },
    { key: "billing.minKm", value: minKm },
    { key: "billing.minDays", value: minDays },
    { key: "billing.ssclRate", value: ssclRate },
    { key: "billing.vatRate", value: vatRate },
    { key: "billing.dueDays", value: dueDays },
    { key: "billing.invoicePrefix", value: invoicePrefix },
  ];

  try {
    await prisma.$transaction(
      entries.map((e) =>
        prisma.setting.upsert({
          where: { key: e.key },
          update: { value: e.value },
          create: { key: e.key, value: e.value },
        })
      )
    );
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Setting",
        summary: `Updated billing settings (cron=${cron}, SSCL=${ssclRate}, VAT=${vatRate})`,
      },
    });
    revalidatePath("/admin/billing");
    return { success: true };
  } catch (err: any) {
    console.error("Update billing settings error:", err);
    return { error: err.message || "Failed to update billing settings" };
  }
}
