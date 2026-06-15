import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as XLSX from "xlsx";

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
  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const bills = await prisma.bill.findMany({
    where: { year, month },
    orderBy: [{ projectName: "asc" }, { assetCode: "asc" }],
  });

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}`, { status: 404 });
  }

  const lkr = (cents: number) => cents / 100;

  try {
    const wb = XLSX.utils.book_new();

    // Sheet 1: per-vehicle rows
    const header = [
      "E&C No", "Vehicle", "Reg No", "Site", "Mode", "Basis",
      "Billable Units", "Rental (LKR)", "Fuel (LKR)", "Subtotal (LKR)",
      "SSCL (LKR)", "VAT (LKR)", "Grand Total (LKR)", "Status", "Invoice No",
    ];
    const rows = bills.map((b) => [
      b.assetCode, b.assetLabel || "", b.assetRegNo || "", b.projectName || "Unassigned",
      b.billingMode, b.rateBasis,
      b.billableUnits, lkr(b.rentalAmountCents), lkr(b.fuelCostCents), lkr(b.subtotalCents),
      lkr(b.ssclCents), lkr(b.vatCents), lkr(b.grandTotalCents), b.status, b.invoiceNumber || "",
    ]);

    // Totals row
    const tot = bills.reduce(
      (a, b) => {
        a.rental += b.rentalAmountCents;
        a.fuel += b.fuelCostCents;
        a.subtotal += b.subtotalCents;
        a.sscl += b.ssclCents;
        a.vat += b.vatCents;
        a.grand += b.grandTotalCents;
        return a;
      },
      { rental: 0, fuel: 0, subtotal: 0, sscl: 0, vat: 0, grand: 0 }
    );
    const totalsRow = [
      "TOTAL", "", "", "", "", "", "",
      lkr(tot.rental), lkr(tot.fuel), lkr(tot.subtotal), lkr(tot.sscl), lkr(tot.vat), lkr(tot.grand), "", "",
    ];

    const sheet1 = [
      [`EDWARD & CHRISTIE — CONSOLIDATED BILLING — ${monthLabel}`],
      [],
      header,
      ...rows,
      [],
      totalsRow,
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), "Consolidated");

    // Sheet 2: summary
    const statusCounts = bills.reduce((acc: Record<string, number>, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    }, {});
    const summary = [
      ["Consolidated Billing Summary"],
      ["Period", monthLabel],
      ["Total Vehicles", bills.length],
      [],
      ["Total Rental (LKR)", lkr(tot.rental)],
      ["Total Fuel (LKR)", lkr(tot.fuel)],
      ["Total Subtotal (LKR)", lkr(tot.subtotal)],
      ["Total SSCL (LKR)", lkr(tot.sscl)],
      ["Total VAT (LKR)", lkr(tot.vat)],
      ["GRAND TOTAL (LKR)", lkr(tot.grand)],
      [],
      ["Status Breakdown"],
      ...Object.entries(statusCounts).map(([s, c]) => [s, c]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="consolidated_billing_${periodKey}.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("Consolidated XLSX error:", err);
    return new NextResponse("Failed to compile consolidated workbook.", { status: 500 });
  }
}
