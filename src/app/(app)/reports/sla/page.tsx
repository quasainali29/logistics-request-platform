import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import { CATEGORY_LABELS, type Category, type WorkflowStage } from "@/lib/types";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";
import { BarList } from "../_components/BarList";

const CATEGORIES: Category[] = ["delivery", "labor", "maintenance", "procurement"];

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

export default async function SlaReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string }>;
}) {
  const profile = await requireReportPermission("view_report_sla");
  const params = await searchParams;
  const { from, to } = parseDateRange(params);
  const category = params.category || "";

  const supabase = await createClient();
  const stages = await getWorkflowStages();
  const today = new Date();

  let terminalQuery = supabase
    .from("requests")
    .select("category, status, date_requested, updated_at")
    .gte("date_requested", from)
    .lte("date_requested", to);
  if (category) terminalQuery = terminalQuery.eq("category", category);

  let overdueQuery = supabase
    .from("requests")
    .select(
      "id, request_number, title, category, status, date_required, owner:profiles!requests_owner_id_fkey(full_name)"
    )
    .not("date_required", "is", null)
    .lt("date_required", today.toISOString().slice(0, 10));
  if (category) overdueQuery = overdueQuery.eq("category", category);

  const [{ data: terminalRows }, { data: overdueRowsRaw }] = await Promise.all([
    terminalQuery,
    overdueQuery,
  ]);

  const turnaroundByCategory = new Map<string, number[]>();
  for (const r of (terminalRows ?? []) as {
    category: string;
    status: string;
    date_requested: string;
    updated_at: string;
  }[]) {
    if (!isTerminal(stages, r.category, r.status)) continue;
    const days = differenceInCalendarDays(parseISO(r.updated_at), parseISO(r.date_requested));
    if (days < 0) continue;
    const list = turnaroundByCategory.get(r.category) ?? [];
    list.push(days);
    turnaroundByCategory.set(r.category, list);
  }

  const avgTurnaroundItems = CATEGORIES.filter((c) => !category || c === category).map((c) => {
    const list = turnaroundByCategory.get(c) ?? [];
    const avg = list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : 0;
    return { label: CATEGORY_LABELS[c], value: avg, sublabel: `days (n=${list.length})` };
  });

  const overdueRows = ((overdueRowsRaw ?? []) as unknown as {
    id: string;
    request_number: string;
    title: string;
    category: string;
    status: string;
    date_required: string;
    owner: { full_name: string } | null;
  }[]).filter((r) => !isTerminal(stages, r.category, r.status));

  const csvHref = `/api/reports/sla/csv?category=${category}`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="sla" profile={profile} />

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
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
          <select
            name="category"
            defaultValue={category}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="bg-[var(--accent)] text-white rounded-md px-4 py-1.5 text-sm font-medium hover:opacity-90 transition"
        >
          Apply
        </button>
        <a href={csvHref} className="ml-auto text-sm text-[var(--accent)] font-medium hover:opacity-80">
          Export overdue list (CSV)
        </a>
      </form>

      <p className="text-xs text-slate-400 mb-6">
        Turnaround is approximated as the time between a request's submission date and the last
        update while it's in a completed/closed status — there's no dedicated "completed at"
        timestamp captured today.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <StatCard label="Currently overdue" value={overdueRows.length} tone={overdueRows.length > 0 ? "danger" : "default"} />
        <StatCard label="Date range (turnaround calc)" value={`${from} → ${to}`} />
      </div>

      <div className="grid sm:grid-cols-1 gap-6 mb-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Average turnaround by category</h2>
          <BarList items={avgTurnaroundItems} />
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Overdue requests (as of today)</h2>
        <div className="overflow-hidden border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Request</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium">Owner</th>
                <th className="text-left px-4 py-2 font-medium">Due date</th>
                <th className="text-left px-4 py-2 font-medium">Days overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overdueRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Nothing overdue right now.
                  </td>
                </tr>
              ) : (
                overdueRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 text-slate-900 font-medium">
                      {r.request_number} — {r.title}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{CATEGORY_LABELS[r.category as Category] ?? r.category}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.owner?.full_name ?? "Unassigned"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.date_required}</td>
                    <td className="px-4 py-2.5 text-red-600 font-medium">
                      {differenceInCalendarDays(today, parseISO(r.date_required))}
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
