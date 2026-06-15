import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, Building2, Calendar } from "lucide-react";
import { unitLabel, basisLabel, modeLabel, type BillingMode, type RateBasis } from "@/lib/billing/calc";
import BillActions from "./BillActions";
import BillingRunningChart from "../components/BillingRunningChart";

interface PageProps {
  params: Promise<{ id: string }>;
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/10",
  ISSUED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/10",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/10",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/10",
};

export default async function BillDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN";
  const { id } = await props.params;

  const bill = await prisma.bill.findUnique({
    where: { id },
    include: { lineItems: true },
  });
  if (!bill) notFound();

  // USER scope: only their own project's bills.
  if (session.role === "USER" && session.projectId && bill.projectId !== session.projectId) {
    notFound();
  }

  // Chart data for the month.
  let readingsData: { date: string; value: number }[] = [];
  if (bill.billingMode === "hourly" || bill.billingMode === "perkm") {
    const meterType = bill.billingMode === "perkm" ? "KM" : "HOURS";
    const readings = await prisma.meterReading.findMany({
      where: { assetId: bill.assetId, readingType: meterType, readingDate: { gte: bill.periodStart, lte: bill.periodEnd } },
      orderBy: { readingDate: "asc" },
    });
    readingsData = readings.map((r) => ({
      date: new Date(r.readingDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      value: r.value,
    }));
  }
  const fuelIssues = await prisma.fuelIssue.findMany({
    where: { assetId: bill.assetId, issueDate: { gte: bill.periodStart, lte: bill.periodEnd } },
    orderBy: { issueDate: "asc" },
  });
  const fuelData = fuelIssues.map((f) => ({
    date: new Date(f.issueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    litres: f.litres,
  }));

  const unit = unitLabel(bill.billingMode as BillingMode);
  const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <Link href="/billing" className="inline-flex items-center gap-2 text-xs text-gray-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> Back to Billing
      </Link>

      {/* Invoice header */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Edward & Christie — Heavy Equipment & Fleet Division</p>
            <h1 className="text-xl font-bold text-white mt-1">
              {bill.invoiceNumber || "DRAFT — not yet issued"}
            </h1>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-3">
              <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {bill.projectName || "Unassigned"}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {monthLabel}</span>
            </p>
          </div>
          <div className="text-right">
            <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${STATUS_STYLES[bill.status] || "bg-white/5 text-gray-400 border-white/5"}`}>
              {bill.status}
            </span>
            <div className="text-xs text-gray-400 mt-3 space-y-1">
              <div>Issued: <span className="text-gray-300">{fmtDate(bill.issuedDate)}</span></div>
              <div>Due: <span className="text-gray-300">{fmtDate(bill.dueDate)}</span></div>
              {bill.status === "PAID" && <div>Paid: <span className="text-emerald-400">{fmtDate(bill.paidDate)}</span></div>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/5">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Vehicle</p>
            <p className="text-sm font-bold text-white mt-1">{bill.assetCode}</p>
            <p className="text-xs text-gray-500">{bill.assetLabel}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Billing</p>
            <p className="text-sm font-bold text-white mt-1">{modeLabel(bill.billingMode as BillingMode)}</p>
            <p className="text-xs text-gray-500">{basisLabel(bill.rateBasis as RateBasis)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Grand Total</p>
            <p className="text-lg font-bold text-white mt-1">{rs(bill.grandTotalCents)}</p>
          </div>
          <div className="flex items-end gap-2">
            <a href={`/api/billing/${bill.id}/pdf`} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center justify-center gap-2">
              <Download className="w-4 h-4" /> PDF
            </a>
            <a href={`/api/billing/${bill.id}/xlsx`} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center justify-center gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </a>
          </div>
        </div>
      </div>

      {/* Running + fuel charts */}
      <BillingRunningChart mode={bill.billingMode} unit={unit} readingsData={readingsData} fuelData={fuelData} />

      {/* Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rental / usage breakdown */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Rental & Usage</h3>
          <dl className="space-y-2.5 text-xs">
            <Row label={`Actual ${unit}`} value={bill.actualUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })} />
            <Row label={`Minimum guaranteed ${unit}`} value={bill.minimumUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })} />
            <Row label={`Billable ${unit}`} value={bill.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 2 })} strong />
            {bill.openingMeter != null && (
              <Row label="Opening → Closing meter" value={`${bill.openingMeter.toLocaleString()} → ${bill.closingMeter?.toLocaleString() ?? "—"}`} />
            )}
            <Row label={`Rate (per ${unit})`} value={rs(bill.rateCents)} />
            <div className="border-t border-white/5 my-2" />
            <Row label="Rental amount" value={rs(bill.rentalAmountCents)} strong />
            <Row label={`Fuel (${bill.fuelLitres.toLocaleString("en-LK", { maximumFractionDigits: 1 })} L)`} value={bill.rateBasis === "fw" && bill.fuelCostCents > 0 ? rs(bill.fuelCostCents) : `Not billed (${basisLabel(bill.rateBasis as RateBasis)})`} />
          </dl>
        </div>

        {/* Tax breakdown */}
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-6">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Invoice Totals</h3>
          <dl className="space-y-2.5 text-xs">
            <Row label="Subtotal" value={rs(bill.subtotalCents)} />
            <Row label={`SSCL (${(bill.ssclRate * 100).toFixed(1)}%)`} value={rs(bill.ssclCents)} />
            <Row label="Pre-VAT" value={rs(bill.subtotalCents + bill.ssclCents)} />
            <Row label={`VAT (${(bill.vatRate * 100).toFixed(1)}%)`} value={rs(bill.vatCents)} />
            <div className="border-t border-white/5 my-2" />
            <Row label="Grand Total" value={rs(bill.grandTotalCents)} strong />
          </dl>
        </div>
      </div>

      {/* Line items */}
      <div className="border border-white/5 rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
              <th className="px-4 py-3">Charge</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit Rate</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {bill.lineItems.map((li) => (
              <tr key={li.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-semibold text-white">{li.kind}</td>
                <td className="px-4 py-3 text-gray-400">{li.description}</td>
                <td className="px-4 py-3 text-right text-gray-300">{li.quantity.toLocaleString("en-LK", { maximumFractionDigits: 2 })} {li.unit}</td>
                <td className="px-4 py-3 text-right text-gray-300">{rs(li.unitRateCents)}</td>
                <td className="px-4 py-3 text-right font-semibold text-white">{rs(li.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bill.notes && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 text-xs text-gray-400">
          <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Notes</span>
          <p className="mt-2">{bill.notes}</p>
        </div>
      )}

      {/* Admin actions */}
      {isAdmin && <BillActions bill={{
        id: bill.id,
        status: bill.status,
        billingMode: bill.billingMode,
        rateBasis: bill.rateBasis,
        minimumUnits: bill.minimumUnits,
        notes: bill.notes,
        grandTotalCents: bill.grandTotalCents,
      }} />}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-400">{label}</dt>
      <dd className={strong ? "text-white font-bold" : "text-gray-300"}>{value}</dd>
    </div>
  );
}
