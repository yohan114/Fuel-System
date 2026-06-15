import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Document, Page, Text, View, StyleSheet, renderToStream } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 9, color: "#333333" },
  header: { marginBottom: 16, borderBottomWidth: 1, borderBottomColor: "#dddddd", paddingBottom: 10, flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "bold", color: "#111111" },
  subtitle: { fontSize: 9, color: "#666666", marginTop: 4 },
  invNo: { fontSize: 12, fontWeight: "bold", color: "#111111" },
  metaRight: { textAlign: "right" },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 6, color: "#111111" },
  row2: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  box: { width: "48%" },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  kvLabel: { color: "#666666" },
  kvVal: { color: "#111111" },
  table: { width: "100%", marginTop: 5 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eeeeee", paddingVertical: 5 },
  tableHeader: { backgroundColor: "#f5f6f8", fontWeight: "bold" },
  cKind: { width: "16%" },
  cDesc: { width: "40%" },
  cQty: { width: "16%", textAlign: "right" },
  cRate: { width: "14%", textAlign: "right" },
  cAmt: { width: "14%", textAlign: "right" },
  cell: { fontSize: 8 },
  totals: { marginTop: 12, marginLeft: "auto", width: "45%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: "#cccccc" },
  grandText: { fontSize: 11, fontWeight: "bold", color: "#111111" },
});

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function d(date: Date | null) {
  return date ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function InvoiceDocument({ bill }: { bill: any }) {
  const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>EDWARD & CHRISTIE (E&C)</Text>
            <Text style={styles.subtitle}>Heavy Equipment & Fleet Division — Machine Rental Invoice</Text>
          </View>
          <View style={styles.metaRight}>
            <Text style={styles.invNo}>{bill.invoiceNumber || "DRAFT"}</Text>
            <Text style={styles.subtitle}>Status: {bill.status}</Text>
            <Text style={styles.subtitle}>Period: {monthLabel}</Text>
          </View>
        </View>

        <View style={styles.row2}>
          <View style={styles.box}>
            <Text style={styles.sectionTitle}>Bill To / Site</Text>
            <Text>{bill.projectName || "Unassigned / Global Pool"}</Text>
            {bill.projectCode ? <Text style={styles.subtitle}>{bill.projectCode}</Text> : null}
          </View>
          <View style={styles.box}>
            <Text style={styles.sectionTitle}>Machine</Text>
            <View style={styles.kv}><Text style={styles.kvLabel}>E&C No.</Text><Text style={styles.kvVal}>{bill.assetCode}</Text></View>
            <View style={styles.kv}><Text style={styles.kvLabel}>Reg No.</Text><Text style={styles.kvVal}>{bill.assetRegNo || "—"}</Text></View>
            <View style={styles.kv}><Text style={styles.kvLabel}>Description</Text><Text style={styles.kvVal}>{bill.assetLabel || "—"}</Text></View>
            <View style={styles.kv}><Text style={styles.kvLabel}>Issued / Due</Text><Text style={styles.kvVal}>{d(bill.issuedDate)} / {d(bill.dueDate)}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Usage</Text>
          <View style={styles.kv}><Text style={styles.kvLabel}>Billing basis</Text><Text style={styles.kvVal}>{bill.billingMode} ({bill.rateBasis.toUpperCase()})</Text></View>
          <View style={styles.kv}><Text style={styles.kvLabel}>Actual / Minimum / Billable</Text><Text style={styles.kvVal}>{bill.actualUnits} / {bill.minimumUnits} / {bill.billableUnits}</Text></View>
          {bill.openingMeter != null ? (
            <View style={styles.kv}><Text style={styles.kvLabel}>Meter opening → closing</Text><Text style={styles.kvVal}>{bill.openingMeter} → {bill.closingMeter}</Text></View>
          ) : null}
          <View style={styles.kv}><Text style={styles.kvLabel}>Fuel issued</Text><Text style={styles.kvVal}>{bill.fuelLitres} L</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Charges</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cKind, styles.cell]}>Charge</Text>
              <Text style={[styles.cDesc, styles.cell]}>Description</Text>
              <Text style={[styles.cQty, styles.cell]}>Qty</Text>
              <Text style={[styles.cRate, styles.cell]}>Rate</Text>
              <Text style={[styles.cAmt, styles.cell]}>Amount</Text>
            </View>
            {bill.lineItems.map((li: any, i: number) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.cKind, styles.cell]}>{li.kind}</Text>
                <Text style={[styles.cDesc, styles.cell]}>{li.description}</Text>
                <Text style={[styles.cQty, styles.cell]}>{li.quantity.toLocaleString("en-LK", { maximumFractionDigits: 2 })} {li.unit}</Text>
                <Text style={[styles.cRate, styles.cell]}>{rs(li.unitRateCents)}</Text>
                <Text style={[styles.cAmt, styles.cell]}>{rs(li.amountCents)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.totals}>
            <View style={styles.totalRow}><Text style={styles.kvLabel}>Subtotal</Text><Text style={styles.kvVal}>{rs(bill.subtotalCents)}</Text></View>
            <View style={styles.totalRow}><Text style={styles.kvLabel}>SSCL ({(bill.ssclRate * 100).toFixed(1)}%)</Text><Text style={styles.kvVal}>{rs(bill.ssclCents)}</Text></View>
            <View style={styles.totalRow}><Text style={styles.kvLabel}>VAT ({(bill.vatRate * 100).toFixed(1)}%)</Text><Text style={styles.kvVal}>{rs(bill.vatCents)}</Text></View>
            <View style={styles.grand}><Text style={styles.grandText}>Grand Total</Text><Text style={styles.grandText}>{rs(bill.grandTotalCents)}</Text></View>
          </View>
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
