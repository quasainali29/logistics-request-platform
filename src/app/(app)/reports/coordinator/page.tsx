import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import type { WorkflowStage } from "@/lib/types";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

export default async function CoordinatorReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const profile = await requireReportPermission("view_report_coordinator");
  const params = await searchParams;
  const { from, to } = parseDateRange(params);

  const supabase = await createClient();
  const stages = await getWorkflowStages();

  const { data } = await supabase
    .from("requests")
    .select(
      "owner_id, category, status, date_requested, updated_at, owner:profiles!requests_owner_id_fkey(full_name)"
    )
    .gte("date_requested", from)
    .lte("date_requested", to);

  const rows = (data ?? []) as unknown as {
    owner_id: string | null;
    category: string;
    status: string;
    date_requested: string;
    updated_at: string;
    owner: { full_name: string } | null;
  }[];

  type Agg = { name: string; total: number; open: number; done: number; turnarounds: number[] };
  const byOwner = new Map<string, Agg>();

  for (const r of rows) {
    const key = r.owner_id ?? "unassigned";
    const name = r.owner?.full_name ?? "Unassigned";
    const agg = byOwner.get(key) ?? { name, total: 0, open: 0, done: 0, turnarounds: [] };
    agg.total += 1;
    if (isTerminal(stages, r.category, r.status)) {
      agg.done += 1;
      const days = differenceInCalendarDays(parseISO(r.updated_at), parseISO(r.date_requested));
      if (days >= 0) agg.turnarounds.push(days);
    } else {
      agg.open += 1;
    }
    byOwner.set(key, agg);
  }

  const ownerRows = Array.from(byOwner.values())
    .map((agg) => ({
      ...agg,
      avgTurnaround: agg.turnarounds.length
        ? Math.round((agg.turnarounds.reduce((a, b) => a + b, 0) / agg.turnarounds.length) * 10) / 10
        : null,
    }))
    .sort((a, b) => b.total - a.total);

  const csvHref = `/api/reports/coordinator/csv?from=${from}&to=${to}`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="coordinator" profile={profile} />

      <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
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

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <StatCard label="Coordinators/owners with requests" value={ownerRows.length} />
        <StatCard label="Date range" value={`${from} → ${to}`} />
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Workload by owner</h2>
        <div className="overflow-hidden border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Owner</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-right px-4 py-2 font-medium">Open</th>
                <th className="text-right px-4 py-2 font-medium">Completed/Closed</th>
                <th className="text-right px-4 py-2 font-medium">Avg turnaround</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ownerRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No requests in this range.
                  </td>
                </tr>
              ) : (
                ownerRows.map((o) => (
                  <tr key={o.name}>
                    <td className="px-4 py-2.5 text-slate-900 font-medium">{o.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-900">{o.total}</td>
                    <td className="px-4 py-2.5 text-right text-amber-600">{o.open}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{o.done}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {o.avgTurnaround !== null ? `${o.avgTurnaround}d` : "—"}
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
