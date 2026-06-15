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
  vatReg: "VAT Reg: 114-236-8891",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: WHITE },

  // Header band
  headerBand: { backgroundColor: NAVY, padding: "20 32 16 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: WHITE, letterSpacing: 0.5 },
  companyDiv: { fontSize: 8, color: "#93c5fd", marginTop: 3 },
  invoiceLabel: { fontSize: 18, fontFamily: "Helvetica-Bold", color: AMBER, textAlign: "right" },
  invoiceNum: { fontSize: 10, fontFamily: "Helvetica-Bold", color: WHITE, textAlign: "right", marginTop: 3 },
  statusBadge: { fontSize: 7, color: "#93c5fd", textAlign: "right", marginTop: 2, textTransform: "uppercase" },

  // Amber accent strip
  accentStrip: { backgroundColor: AMBER, height: 3 },

  // Info bar below header
  infoBar: { backgroundColor: LIGHT, padding: "10 32", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  infoItem: { flexDirection: "column" },
  infoLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 8.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  infoSub: { fontSize: 7.5, color: GRAY },

  // Body
  body: { padding: "14 32" },

  // Parties row
  partiesRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  partyBox: { flex: 1, borderWidth: 1, borderColor: GRAY_LIGHT, borderRadius: 4, padding: "8 10" },
  partyTitle: { fontSize: 7, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT, paddingBottom: 3 },
  partyLine: { fontSize: 8, color: "#334155", marginBottom: 2 },
  partyGray: { fontSize: 7.5, color: GRAY },

  // Section heading
  secHeading: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: NAVY, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, marginTop: 12 },

  // Usage grid
  usageGrid: { flexDirection: "row", gap: 6, marginBottom: 12 },
  usageCell: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: "6 8", alignItems: "center" },
  usageCellLabel: { fontSize: 7, color: GRAY, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  usageCellVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY },
  usageCellUnit: { fontSize: 7, color: GRAY },

  // Charges table
  table: { width: "100%", marginTop: 4 },
  tHead: { flexDirection: "row", backgroundColor: NAVY, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6 },
  tHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: WHITE, textTransform: "uppercase", letterSpacing: 0.4 },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT, paddingVertical: 5, paddingHorizontal: 6 },
  tRowAlt: { backgroundColor: LIGHT },
  cKind: { width: "13%" },
  cDesc: { width: "41%" },
  cQty:  { width: "16%", textAlign: "right" },
  cRate: { width: "15%", textAlign: "right" },
  cAmt:  { width: "15%", textAlign: "right" },
  tCell: { fontSize: 8, color: "#334155" },
  tCellBold: { fontFamily: "Helvetica-Bold", color: NAVY },
  tCellFuel: { color: "#b45309" },
  tCellAdj: { color: "#b91c1c" },

  // Totals
  totalsOuter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  totalsBox: { width: "44%", borderWidth: 1, borderColor: GRAY_LIGHT, borderRadius: 4, overflow: "hidden" },
  totRow: { flexDirection: "row", justifyContent: "space-between", padding: "5 10", borderBottomWidth: 1, borderBottomColor: GRAY_LIGHT },
  totLabel: { fontSize: 8, color: GRAY },
  totVal: { fontSize: 8, color: "#334155", fontFamily: "Helvetica-Bold" },
  grandRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: NAVY, padding: "7 10" },
  grandLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: WHITE },
  grandVal: { fontSize: 9, fontFamily: "Helvetica-Bold", color: AMBER },

  // Footer
  footer: { backgroundColor: AMBER, padding: "6 32", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: "auto" },
  footerText: { fontSize: 7.5, color: NAVY, fontFamily: "Helvetica-Bold" },
  footerSub: { fontSize: 7, color: "#78350f" },
});

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function d(date: Date | null | undefined) {
  return date ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function InvoiceDocument({ bill }: { bill: any }) {
  const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const isDraft = bill.status === "DRAFT";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.companyName}>{COMPANY.name}</Text>
            <Text style={styles.companyDiv}>{COMPANY.division}</Text>
          </View>
          <View>
            <Text style={styles.invoiceLabel}>TAX INVOICE</Text>
            <Text style={styles.invoiceNum}>{bill.invoiceNumber || (isDraft ? "DRAFT" : "—")}</Text>
            <Text style={styles.statusBadge}>{bill.status} · {monthLabel}</Text>
          </View>
        </View>
        <View style={styles.accentStrip} />

        {/* Info bar */}
        <View style={styles.infoBar}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Issued</Text>
            <Text style={styles.infoVal}>{d(bill.issuedDate)}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Due Date</Text>
            <Text style={styles.infoVal}>{d(bill.dueDate)}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Period</Text>
            <Text style={styles.infoVal}>{monthLabel}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Billing Mode</Text>
            <Text style={styles.infoVal}>{bill.billingMode.toUpperCase()} · {bill.rateBasis.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Parties */}
          <View style={styles.partiesRow}>
            <View style={styles.partyBox}>
              <Text style={styles.partyTitle}>From (Supplier)</Text>
              <Text style={styles.partyLine}>{COMPANY.name}</Text>
              <Text style={styles.partyGray}>{COMPANY.address}</Text>
              <Text style={styles.partyGray}>{COMPANY.phone}</Text>
              <Text style={styles.partyGray}>{COMPANY.email}</Text>
              <Text style={styles.partyGray}>{COMPANY.vatReg}</Text>
            </View>
            <View style={styles.partyBox}>
              <Text style={styles.partyTitle}>Bill To (Site / Client)</Text>
              <Text style={styles.partyLine}>{bill.projectName || "Unassigned / Global Pool"}</Text>
              {bill.projectCode ? <Text style={styles.partyGray}>Project Code: {bill.projectCode}</Text> : null}
            </View>
            <View style={styles.partyBox}>
              <Text style={styles.partyTitle}>Machine Details</Text>
              <Text style={styles.partyLine}>E&C No: {bill.assetCode}</Text>
              <Text style={styles.partyGray}>Reg No: {bill.assetRegNo || "—"}</Text>
              <Text style={styles.partyGray}>{bill.assetLabel || "—"}</Text>
            </View>
          </View>

          {/* Usage summary */}
          <Text style={styles.secHeading}>Usage Summary</Text>
          <View style={styles.usageGrid}>
            <View style={styles.usageCell}>
              <Text style={styles.usageCellLabel}>Actual</Text>
              <Text style={styles.usageCellVal}>{bill.actualUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>{bill.billingMode === "hourly" ? "hrs" : bill.billingMode === "perkm" ? "km" : "days"}</Text>
            </View>
            <View style={styles.usageCell}>
              <Text style={styles.usageCellLabel}>Minimum</Text>
              <Text style={styles.usageCellVal}>{bill.minimumUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>{bill.billingMode === "hourly" ? "hrs" : bill.billingMode === "perkm" ? "km" : "days"}</Text>
            </View>
            <View style={[styles.usageCell, { backgroundColor: "#dbeafe" }]}>
              <Text style={styles.usageCellLabel}>Billable</Text>
              <Text style={[styles.usageCellVal, { color: NAVY }]}>{bill.billableUnits.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>{bill.billingMode === "hourly" ? "hrs" : bill.billingMode === "perkm" ? "km" : "days"}</Text>
            </View>
            <View style={styles.usageCell}>
              <Text style={styles.usageCellLabel}>Fuel Issued</Text>
              <Text style={styles.usageCellVal}>{bill.fuelLitres.toLocaleString("en-LK", { maximumFractionDigits: 1 })}</Text>
              <Text style={styles.usageCellUnit}>litres</Text>
            </View>
            {bill.openingMeter != null && (
              <View style={styles.usageCell}>
                <Text style={styles.usageCellLabel}>Meter</Text>
                <Text style={[styles.usageCellVal, { fontSize: 8 }]}>{bill.openingMeter.toLocaleString()} →</Text>
                <Text style={[styles.usageCellUnit, { fontSize: 8 }]}>{bill.closingMeter?.toLocaleString()}</Text>
              </View>
            )}
          </View>

          {/* Charges table */}
          <Text style={styles.secHeading}>Charges</Text>
          <View style={styles.table}>
            <View style={styles.tHead}>
              <Text style={[styles.tHeadCell, styles.cKind]}>Type</Text>
              <Text style={[styles.tHeadCell, styles.cDesc]}>Description</Text>
              <Text style={[styles.tHeadCell, styles.cQty]}>Qty</Text>
              <Text style={[styles.tHeadCell, styles.cRate]}>Unit Rate</Text>
              <Text style={[styles.tHeadCell, styles.cAmt]}>Amount</Text>
            </View>
            {bill.lineItems.map((li: any, i: number) => {
              const isAlt = i % 2 === 1;
              const kindStyle = li.kind === "FUEL" ? styles.tCellFuel : li.kind === "ADJUSTMENT" ? styles.tCellAdj : styles.tCellBold;
              return (
                <View key={i} style={[styles.tRow, isAlt ? styles.tRowAlt : {}]}>
                  <Text style={[styles.tCell, styles.cKind, kindStyle]}>{li.kind}</Text>
                  <Text style={[styles.tCell, styles.cDesc]}>{li.description}</Text>
                  <Text style={[styles.tCell, styles.cQty]}>{li.quantity.toLocaleString("en-LK", { maximumFractionDigits: 2 })} {li.unit}</Text>
                  <Text style={[styles.tCell, styles.cRate]}>{rs(li.unitRateCents)}</Text>
                  <Text style={[styles.tCell, styles.cAmt, kindStyle]}>{rs(li.amountCents)}</Text>
                </View>
              );
            })}
          </View>

          {/* Totals */}
          <View style={styles.totalsOuter}>
            <View style={styles.totalsBox}>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>Subtotal</Text>
                <Text style={styles.totVal}>{rs(bill.subtotalCents)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>SSCL ({(bill.ssclRate * 100).toFixed(1)}%)</Text>
                <Text style={styles.totVal}>{rs(bill.ssclCents)}</Text>
              </View>
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>VAT ({(bill.vatRate * 100).toFixed(1)}%)</Text>
                <Text style={styles.totVal}>{rs(bill.vatCents)}</Text>
              </View>
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <Text style={styles.grandVal}>{rs(bill.grandTotalCents)}</Text>
              </View>
            </View>
          </View>

          {isDraft && (
            <View style={{ marginTop: 12, padding: "6 10", backgroundColor: "#fef3c7", borderRadius: 4 }}>
              <Text style={{ fontSize: 7.5, color: "#92400e", fontFamily: "Helvetica-Bold" }}>
                DRAFT — This document is not a valid tax invoice until issued.
              </Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for your business!</Text>
          <Text style={styles.footerSub}>{COMPANY.email} · {COMPANY.phone}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const bill = await prisma.bill.findUnique({ where: { id }, include: { lineItems: true } });
  if (!bill) return new NextResponse("Not found", { status: 404 });

  if (session.role === "USER" && session.projectId && bill.projectId !== session.projectId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const stream = await renderToStream(<InvoiceDocument bill={bill} />);
    const fileTag = `${bill.assetCode}_${bill.periodKey}`;
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="invoice_${fileTag}.pdf"`);
    return response;
  } catch (err: any) {
    console.error("Bill PDF error:", err);
    return new NextResponse("Failed to compile invoice PDF.", { status: 500 });
  }
}
