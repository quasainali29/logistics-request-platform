import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";

type ContractRow = {
  id: string;
  supplier_name: string;
  next_maintenance_date: string;
  location: { name: string } | null;
  type: { name: string; requires_compliance: boolean } | null;
};

export default async function AmcReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; status?: string }>;
}) {
  const profile = await requireReportPermission("view_report_amc");
  const params = await searchParams;
  const daysAhead = parseInt(params.days || "60", 10) || 60;
  const statusFilter = params.status || "all";
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

  const overdueCount = rows.filter((r) => r.bucket === "overdue").length;
  const dueSoonCount = rows.filter((r) => r.bucket === "due_soon").length;
  const complianceIssues = rows.filter((r) => r.complianceStatus === "Missing" || r.complianceStatus === "Expired").length;

  const csvHref = `/api/reports/amc/csv?days=${daysAhead}&status=${statusFilter}`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="amc" profile={profile} />

      <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Due soon window</label>
          <select
            name="days"
            defaultValue={String(daysAhead)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="30">Next 30 days</option>
            <option value="60">Next 60 days</option>
            <option value="90">Next 90 days</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Show</label>
          <select
            name="status"
            defaultValue={statusFilter}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">All contracts</option>
            <option value="overdue">Overdue only</option>
            <option value="due_soon">Due soon only</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-[var(--accent)] text-white rounded-md px-4 py-1.5 text-sm font-medium hover:opacity-90 transition"
        >
          Apply
        </button>
        <a href={csvHref} className="ml-auto text-sm text-[var(--accent)] font-medium hover:opacity-80">
          Export CSV
        </a>
      </form>

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Overdue for maintenance" value={overdueCount} tone={overdueCount > 0 ? "danger" : "default"} />
        <StatCard label={`Due within ${daysAhead} days`} value={dueSoonCount} tone={dueSoonCount > 0 ? "warning" : "default"} />
        <StatCard label="Compliance issues" value={complianceIssues} tone={complianceIssues > 0 ? "danger" : "default"} />
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Contracts</h2>
        <div className="overflow-hidden border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Location</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Supplier</th>
                <th className="text-left px-4 py-2 font-medium">Next maintenance</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    Nothing matches this filter.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 text-slate-900 font-medium">{r.location?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.type?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.supplier_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.next_maintenance_date}</td>
                    <td className="px-4 py-2.5">
                      {r.bucket === "overdue" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">
                          {Math.abs(r.daysUntil)}d overdue
                        </span>
                      ) : r.bucket === "due_soon" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
                          Due in {r.daysUntil}d
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">
                          Upcoming
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.complianceStatus === "N/A" ? (
                        <span className="text-slate-400 text-xs">N/A</span>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            r.complianceStatus === "Valid"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {r.complianceStatus}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
