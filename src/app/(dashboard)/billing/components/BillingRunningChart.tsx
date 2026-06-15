"use client";

import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface RunningPoint {
  date: string;
  value: number;
}
interface FuelPoint {
  date: string;
  litres: number;
}

interface Props {
  mode: string; // "hourly" | "perkm" | "perday"
  unit: string; // "hr" | "km" | "day"
  readingsData: RunningPoint[];
  fuelData: FuelPoint[];
}

export default function BillingRunningChart({ mode, unit, readingsData, fuelData }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-72 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
        <div className="h-72 bg-[#121420] border border-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const runningTitle =
    mode === "perkm" ? "Monthly Running (KM)" : mode === "perday" ? "Daily Hours Logged" : "Monthly Running (Hours)";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* 1. Running curve within the month */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
          {runningTitle}
        </h3>
        <div className="h-60 w-full">
          {readingsData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500 text-center px-4">
              {mode === "perday"
                ? "Per-day billing uses working-day logs; no meter curve."
                : "No meter readings logged for this month."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={readingsData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px" }}
                  formatter={(value: any) => [`${Number(value).toLocaleString()} ${unit}`, "Reading"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#10b981" }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. Fuel quantity issued */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
          Fuel Quantity Issued (L)
        </h3>
        <div className="h-60 w-full">
          {fuelData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-500">
              No fuel issued this month.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fuelData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1b1e30", borderColor: "rgba(255,255,255,0.05)", borderRadius: "12px" }}
                  labelStyle={{ color: "#9ca3af", fontSize: "11px" }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)} Litres`, "Volume"]}
                />
                <Bar dataKey="litres" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
