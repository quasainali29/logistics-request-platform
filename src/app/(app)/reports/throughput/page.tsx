import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getActiveProjects, getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import { CATEGORY_LABELS, formatStatusLabel, type Category } from "@/lib/types";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";
import { BarList } from "../_components/BarList";

const CATEGORIES: Category[] = ["delivery", "labor", "maintenance", "procurement"];

export default async function ThroughputReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; project?: string }>;
}) {
  const profile = await requireReportPermission("view_report_throughput");
  const params = await searchParams;
  const { from, to } = parseDateRange(params);
  const category = params.category || "";
  const projectId = params.project || "";

  const supabase = await createClient();
  const [projects, stages] = await Promise.all([getActiveProjects(), getWorkflowStages()]);

  let query = supabase
    .from("requests")
    .select("category, status")
    .gte("date_requested", from)
    .lte("date_requested", to);
  if (category) query = query.eq("category", category);
  if (projectId) query = query.eq("project_id", projectId);

  const { data: rows } = await query;
  const requestRows = (rows ?? []) as { category: string; status: string }[];

  const byCategory = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const r of requestRows) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  }

  const categoryItems = CATEGORIES.filter((c) => !category || c === category).map((c) => ({
    label: CATEGORY_LABELS[c],
    value: byCategory.get(c) ?? 0,
  }));

  const statusItems = Array.from(byStatus.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({
      label: formatStatusLabel(category || "delivery", key, stages),
      value,
    }));

  const csvHref = `/api/reports/throughput/csv?from=${from}&to=${to}&category=${category}&project=${projectId}`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="throughput" profile={profile} />

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
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Project</label>
          <select
            name="project"
            defaultValue={projectId}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="">All projects</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
        <a
          href={csvHref}
          className="ml-auto text-sm text-[var(--accent)] font-medium hover:opacity-80"
        >
          Export CSV
        </a>
      </form>

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total requests" value={requestRows.length} />
        <StatCard label="Date range" value={`${from} → ${to}`} />
        <StatCard label="Categories shown" value={category ? CATEGORY_LABELS[category as Category] : "All"} />
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">By category</h2>
          <BarList items={categoryItems} />
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">By status</h2>
          <BarList items={statusItems} barColor="#0f172a" />
        </section>
      </div>
    </div>
  );
}
