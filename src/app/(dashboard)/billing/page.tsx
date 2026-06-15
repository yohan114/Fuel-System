import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { currentMonthPeriod } from "@/lib/billing/period";
import { Receipt, Wallet, FileText, AlertTriangle } from "lucide-react";
import GenerateBillsPanel from "./components/GenerateBillsPanel";

interface PageProps {
  searchParams: Promise<{ month?: string; site?: string; status?: string }>;
}

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/10",
  ISSUED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/10",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/10",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/10",
};

const MODE_LABEL: Record<string, string> = { hourly: "Hourly", perkm: "Per-KM", perday: "Per-Day" };

export default async function BillingPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN";
  const searchParams = await props.searchParams;

  const cur = currentMonthPeriod();
  const periodKey = searchParams.month || cur.periodKey;
  const statusFilter = searchParams.status || "all";
  const siteFilter = searchParams.site || "all";

  const projects = await prisma.project.findMany({ orderBy: { name: "asc" } });

  // Build the where clause. USER role is locked to its own project.
  const where: any = { periodKey };
  if (session.role === "USER" && session.projectId) {
    where.projectId = session.projectId;
  } else if (siteFilter === "unassigned") {
    where.projectId = null;
  } else if (siteFilter !== "all") {
    where.projectId = siteFilter;
  }
  if (statusFilter !== "all") where.status = statusFilter;

  const bills = await prisma.bill.findMany({
    where,
    orderBy: [{ grandTotalCents: "desc" }],
  });

  const totalGrand = bills.reduce((s, b) => s + b.grandTotalCents, 0);
  const totalRental = bills.reduce((s, b) => s + b.rentalAmountCents, 0);
  const totalFuel = bills.reduce((s, b) => s + b.fuelCostCents, 0);
  const overdueCount = bills.filter((b) => b.status === "OVERDUE").length;

  const [y, m] = periodKey.split("-").map(Number);
  const monthLabel = new Date(y, (m || 1) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-400" />
            Monthly Billing
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Per-vehicle rental + fuel statements & invoices for {monthLabel}.
          </p>
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="bg-[#121420] border border-white/5 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Billing Month</label>
          <input
            type="month"
            name="month"
            defaultValue={periodKey}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        {session.role !== "USER" && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Site</label>
            <select
              name="site"
              defaultValue={siteFilter}
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            >
              <option value="all">All sites</option>
              <option value="unassigned">Unassigned / Global Pool</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Status</label>
          <select
            name="status"
            defaultValue={statusFilter}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          >
            <option value="all">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ISSUED">Issued</option>
            <option value="PAID">Paid</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-white/5 hover:bg-white/10 border border-white/5 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all"
        >
          Apply Filters
        </button>
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><FileText className="w-3.5 h-3.5" /> Bills</div>
          <div className="text-lg font-bold text-white mt-1">{bills.length}</div>
        </div>
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><Wallet className="w-3.5 h-3.5" /> Grand Total</div>
          <div className="text-lg font-bold text-white mt-1">{rs(totalGrand)}</div>
        </div>
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Rental / Fuel</div>
          <div className="text-sm font-bold text-white mt-1">{rs(totalRental)} <span className="text-gray-500">/</span> {rs(totalFuel)}</div>
        </div>
        <div className="bg-[#121420] border border-white/5 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider"><AlertTriangle className="w-3.5 h-3.5" /> Overdue</div>
          <div className={`text-lg font-bold mt-1 ${overdueCount ? "text-red-400" : "text-white"}`}>{overdueCount}</div>
        </div>
      </div>

      {/* Admin generate panel */}
      {isAdmin && <GenerateBillsPanel defaultYear={y || cur.year} defaultMonth={m || cur.month} />}

      {/* Bills table */}
      {bills.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-500 bg-[#121420] border border-white/5 rounded-2xl">
          No bills for {monthLabel}.{isAdmin ? " Use Generate Monthly Bills above." : ""}
        </div>
      ) : (
        <div className="border border-white/5 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Mode / Basis</th>
                <th className="px-4 py-3 text-right">Billable</th>
                <th className="px-4 py-3 text-right">Rental</th>
                <th className="px-4 py-3 text-right">Fuel</th>
                <th className="px-4 py-3 text-right">Grand Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {bills.map((b) => (
                <tr key={b.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={`/billing/${b.id}`} className="font-semibold text-white hover:text-indigo-400">
                      {b.assetCode}
                    </Link>
                    <div className="text-gray-500">{b.assetLabel}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{b.projectName || "Unassigned"}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {MODE_LABEL[b.billingMode]} <span className="text-gray-600">·</span> {b.rateBasis.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {b.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{rs(b.rentalAmountCents)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{b.fuelCostCents > 0 ? rs(b.fuelCostCents) : "—"}</td>
                  <td className="px-4 py-3 text-right font-bold text-white">{rs(b.grandTotalCents)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${STATUS_STYLES[b.status] || "bg-white/5 text-gray-400 border-white/5"}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
