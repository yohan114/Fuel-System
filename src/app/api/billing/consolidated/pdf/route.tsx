import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";

const NAVY = "#1e3a5f";
const AMBER = "#f59e0b";
const LIGHT = "#f8fafc";
const WHITE = "#ffffff";
const GRAY = "#64748b";
const GRAY_LIGHT = "#e2e8f0";

const COMPANY = {
  name: "Edward & Christie (Pvt) Ltd",
  division: "Heavy Equipment & Fleet Division",
  address: "No. 123, Bauddhaloka Mawatha, Colombo 04, Sri Lanka",
  phone: "+94 11 234 5678",
  email: "fleet@edwardchristie.lk",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: WHITE },
  headerBand: { backgroundColor: NAVY, padding: "18 32 14 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: WHITE },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 2 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right" },
  docSub: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 3 },
  accentStrip: { backgroundColor: AMBER, height: 3 },
  body: { padding: "14 32" },

  // Summary cards
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  summaryCard: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: "8 10", borderWidth: 1, borderColor: GRAY_LIGHT },
  summaryLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GRAY, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  summaryVal: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  summaryUnit: { fontSize: 7, color: GRAY },

  secHeading: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },

  // Vehicle table
  table: { width: "100%" },
  tHead: { flexDirection: "row", backgroundColor: NAVY, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6 },
  tHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT, paddingVertical: 5, paddingHorizontal: 6 },
  tRowAlt: { backgroundColor: LIGHT },
  cCode:   { width: "12%" },
  cLabel:  { width: "22%" },
  cSite:   { width: "18%" },
  cMode:   { width: "12%" },
  cRental: { width: "12%", textAlign: "right" },
  cFuel:   { width: "12%", textAlign: "right" },
  cGrand:  { width: "12%", textAlign: "right" },
  tCell: { fontSize: 7.5, color: "#334155" },
  tCellBold: { fontFamily: "Helvetica-Bold", color: NAVY },

  // Totals
  totalsBox: { marginTop: 12, marginLeft: "auto", width: "38%", borderWidth: 1, borderColor: GRAY_LIGHT, borderRadius: 4, overflow: "hidden" },
  totRow: { flexDirection: "row", justifyContent: "space-between", padding: "5 10", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  totLabel: { fontSize: 8, color: GRAY },
  totVal: { fontSize: 8, color: "#334155", fontFamily: "Helvetica-Bold" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: NAVY, padding: "7 10" },
  grandLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: WHITE },
  grandVal: { fontSize: 9, fontFamily: "Helvetica-Bold", color: AMBER },

  footer: { backgroundColor: AMBER, padding: "6 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: "auto" },
  footerText: { fontSize: 7.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  footerSub: { fontSize: 7, color: "#78350f" },
});

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLORS: Record<string, string> = {
  PAID: "#065f46",
  ISSUED: "#1e40af",
  DRAFT: "#92400e",
  OVERDUE: "#991b1b",
};

function ConsolidatedDocument({ bills, periodKey, generatedAt }: { bills: any[]; periodKey: string; generatedAt: string }) {
  const monthLabel = (() => {
    const [y, m] = periodKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  })();

  const totalRental = bills.reduce((s, b) => s + b.rentalAmountCents, 0);
  const totalFuel = bills.reduce((s, b) => s + b.fuelCostCents, 0);
  const totalSscl = bills.reduce((s, b) => s + b.ssclCents, 0);
  const totalVat = bills.reduce((s, b) => s + b.vatCents, 0);
  const grandTotal = bills.reduce((s, b) => s + b.grandTotalCents, 0);

  const statusCounts = bills.reduce((acc: Record<string, number>, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <Document>
      {/* Cover / Summary page */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.companyName}>{COMPANY.name}</Text>
            <Text style={styles.companyDiv}>{COMPANY.division}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>CONSOLIDATED BILLING</Text>
            <Text style={styles.docSub}>Period: {monthLabel} · Generated: {generatedAt}</Text>
          </View>
        </View>
        <View style={styles.accentStrip} />

        <View style={styles.body}>
          {/* KPI cards */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Vehicles</Text>
              <Text style={styles.summaryVal}>{bills.length}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Rental</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(totalRental)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Fuel</Text>
              <Text style={[styles.summaryVal, { fontSize: 11 }]}>{rs(totalFuel)}</Text>
            </View>
            <View style={[styles.summaryCard, { borderColor: NAVY, borderWidth: 1.5 }]}>
              <Text style={styles.summaryLabel}>Grand Total</Text>
              <Text style={[styles.summaryVal, { fontSize: 11, color: NAVY }]}>{rs(grandTotal)}</Text>
            </View>
          </View>

          {/* Status breakdown */}
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
            {Object.entries(statusCounts).map(([status, count]) => (
              <View key={status} style={{ backgroundColor: LIGHT, borderRadius: 4, padding: "5 8", borderWidth: 1, borderColor: GRAY_LIGHT }}>
                <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: STATUS_COLORS[status] || GRAY }}>{status}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: "#334155" }}>{count}</Text>
              </View>
            ))}
          </View>

          {/* Vehicle table */}
          <Text style={styles.secHeading}>Vehicle Billing Summary</Text>
          <View style={styles.table}>
            <View style={styles.tHead}>
              <Text style={[styles.tHeadCell, styles.cCode]}>E&C No</Text>
              <Text style={[styles.tHeadCell, styles.cLabel]}>Vehicle</Text>
              <Text style={[styles.tHeadCell, styles.cSite]}>Site</Text>
              <Text style={[styles.tHeadCell, styles.cMode]}>Mode/Basis</Text>
              <Text style={[styles.tHeadCell, styles.cRental]}>Rental</Text>
              <Text style={[styles.tHeadCell, styles.cFuel]}>Fuel</Text>
              <Text style={[styles.tHeadCell, styles.cGrand]}>Grand Total</Text>
            </View>
            {bills.map((b, i) => (
              <View key={b.id} style={[styles.tRow, i % 2 === 1 ? styles.tRowAlt : {}]}>
                <Text style={[styles.tCell, styles.cCode, styles.tCellBold]}>{b.assetCode}</Text>
                <Text style={[styles.tCell, styles.cLabel]}>{b.assetLabel || "—"}</Text>
                <Text style={[styles.tCell, styles.cSite]}>{b.projectName || "Unassigned"}</Text>
                <Text style={[styles.tCell, styles.cMode]}>{b.billingMode.toUpperCase()} · {b.rateBasis.toUpperCase()}</Text>
                <Text style={[styles.tCell, styles.cRental]}>{rs(b.rentalAmountCents)}</Text>
                <Text style={[styles.tCell, styles.cFuel]}>{b.fuelCostCents > 0 ? rs(b.fuelCostCents) : "—"}</Text>
                <Text style={[styles.tCell, styles.cGrand, styles.tCellBold]}>{rs(b.grandTotalCents)}</Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={styles.totalsBox}>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Total Rental</Text>
              <Text style={styles.totVal}>{rs(totalRental)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Total Fuel</Text>
              <Text style={styles.totVal}>{rs(totalFuel)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Total SSCL</Text>
              <Text style={styles.totVal}>{rs(totalSscl)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Total VAT</Text>
              <Text style={styles.totVal}>{rs(totalVat)}</Text>
            </View>
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Grand Total</Text>
              <Text style={styles.grandVal}>{rs(grandTotal)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Edward & Christie (Pvt) Ltd — Consolidated Statement · {monthLabel}</Text>
          <Text style={styles.footerSub}>{COMPANY.email}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || "", 10);
  const month = parseInt(searchParams.get("month") || "", 10);

  if (!year || !month || month < 1 || month > 12) {
    return new NextResponse("year and month query parameters are required", { status: 400 });
  }

  const periodKey = `${year}-${String(month).padStart(2, "0")}`;

  const bills = await prisma.bill.findMany({
    where: { year, month },
    orderBy: [{ projectName: "asc" }, { assetCode: "asc" }],
  });

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}`, { status: 404 });
  }

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  try {
    const stream = await renderToStream(
      <ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} />
    );
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="consolidated_billing_${periodKey}.pdf"`);
    return response;
  } catch (err: any) {
    console.error("Consolidated PDF error:", err);
    return new NextResponse("Failed to compile consolidated PDF.", { status: 500 });
  }
}
