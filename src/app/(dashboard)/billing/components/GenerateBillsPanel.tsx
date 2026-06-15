"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { generateBillsForMonthAction } from "@/app/actions/billing";

interface Props {
  defaultYear: number;
  defaultMonth: number;
}

export default function GenerateBillsPanel({ defaultYear, defaultMonth }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [regenerate, setRegenerate] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMessage(null);
    const fd = new FormData();
    fd.set("year", String(year));
    fd.set("month", String(month));
    if (regenerate) fd.set("regenerate", "true");
    startTransition(async () => {
      const res = await generateBillsForMonthAction(fd);
      if ((res as any).error) {
        setMessage({ ok: false, text: (res as any).error });
      } else {
        const r = (res as any).result;
        setMessage({
          ok: true,
          text: `Done for ${r.periodKey}: ${r.created} created, ${r.regenerated} regenerated, ${r.skippedExisting} existing, ${r.skippedFinalized} finalized (locked), ${r.noRate} no rate card.`,
        });
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-400" />
        Generate Monthly Bills
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300 select-none pb-2.5">
          <input
            type="checkbox"
            checked={regenerate}
            onChange={(e) => setRegenerate(e.target.checked)}
            className="accent-indigo-500 w-4 h-4"
          />
          Regenerate drafts
        </label>
        <button
          onClick={run}
          disabled={pending}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {pending ? "Generating…" : "Generate"}
        </button>
      </div>
      {message && (
        <div
          className={`text-xs rounded-xl px-4 py-3 border ${
            message.ok
              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/10"
              : "bg-red-500/10 text-red-300 border-red-500/10"
          }`}
        >
          {message.text}
        </div>
      )}
      <p className="text-[10px] text-gray-500">
        Regenerate refreshes <span className="text-gray-400">draft</span> bills only — issued / paid invoices are locked.
      </p>
    </div>
  );
}
