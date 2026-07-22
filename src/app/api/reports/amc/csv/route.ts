import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { csvResponse } from "@/lib/csv";

type ContractRow = {
  id: string;
  supplier_name: string;
  next_maintenance_date: string;
  location: { name: string } | null;
  type: { name: string; requires_compliance: boolean } | null;
};

export async function GET(req: NextRequest) {
  await requireReportPermission("view_report_amc");

  const sp = req.nextUrl.searchParams;
  const daysAhead = parseInt(sp.get("days") || "60", 10) || 60;
  const statusFilter = sp.get("status") || "all";
  const today = new Date();

  const supabase = await createClient();
  const [{ data: contracts }, { data: records }] = await Promise.all([
    supabase
      .from("amc_contracts")
      .select(
        "id, supplier_name, next_maintenance_date, location:amc_locations(name), type:amc_types(name, requires_compliance)"
      )
      .order("next_maintenance_date"),
    supabase
      .from("amc_maintenance_records")
      .select("contract_id, compliance_valid_until, performed_date")
      .order("performed_date", { ascending: false }),
  ]);

  const latestComplianceByContract = new Map<string, string | null>();
  for (const rec of (records ?? []) as { contract_id: string; compliance_valid_until: string | null }[]) {
    if (!latestComplianceByContract.has(rec.contract_id)) {
      latestComplianceByContract.set(rec.contract_id, rec.compliance_valid_until);
    }
  }

  const rows = ((contracts ?? []) as unknown as ContractRow[]).map((c) => {
    const daysUntil = differenceInCalendarDays(parseISO(c.next_maintenance_date), today);
    const bucket = daysUntil < 0 ? "overdue" : daysUntil <= daysAhead ? "due_soon" : "ok";

    let complianceStatus = "N/A";
    if (c.type?.requires_compliance) {
      const validUntil = latestComplianceByContract.get(c.id);
      if (!validUntil) complianceStatus = "Missing";
      else complianceStatus = differenceInCalendarDays(parseISO(validUntil), today) < 0 ? "Expired" : "Valid";
    }

    return { ...c, daysUntil, bucket, complianceStatus };
  });

  const filteredRows = statusFilter === "all" ? rows : rows.filter((r) => r.bucket === statusFilter);

  return csvResponse(
    `amc-report-${today.toISOString().slice(0, 10)}.csv`,
    ["Location", "Type", "Supplier", "Next Maintenance", "Days Until/Overdue", "Compliance"],
    filteredRows.map((r) => [
      r.location?.name ?? "",
      r.type?.name ?? "",
      r.supplier_name,
      r.next_maintenance_date,
      r.daysUntil,
      r.complianceStatus,
    ])
  );
}
