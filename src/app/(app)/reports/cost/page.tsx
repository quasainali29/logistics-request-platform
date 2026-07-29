import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getActiveProjects } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import { CATEGORY_LABELS, COST_CATEGORY_LABELS, type Category, type CostCategory } from "@/lib/types";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";
import { BarList } from "../_components/BarList";

const CATEGORIES: Category[] = ["delivery", "labor", "maintenance", "procurement"];

interface CostLineJoinRow {
  id: string;
  cost_category: string;
  amount: number;
  created_at: string;
  request: {
    id: string;
    request_number: string;
    category: string;
    project_id: string | null;
    project: string | null;
    owner: { full_name: string } | null;
    linked_project: { name: string; deleted_at: string | null } | null;
  } | null;
}

export default async function CostReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; project?: string }>;
}) {
  const profile = await requireReportPermission("view_report_cost");
  const params = await searchParams;
  const { from, to } = parseDateRange(params);
  const category = params.category || "";
  const projectId = params.project || "";

  const supabase = await createClient();
  const projects = await getActiveProjects();

  // request_cost_lines doesn't carry category/project itself — those live
  // on the parent request — so the date-range filter applies at the
  // top level here and the category/project filters are applied after the
  // join comes back, same tradeoff the other joined reports make.
  const { data: rows } = await supabase
    .from("request_cost_lines")
    .select(
      "id, cost_category, amount, created_at, request:requests!request_cost_lines_request_id_fkey(id, request_number, category, project_id, project, owner:profiles!requests_owner_id_fkey(full_name), linked_project:projects!requests_project_id_fkey(name, deleted_at))"
    )
    .gte("created_at", from)
    .lte("created_at", `${to}T23:59:59`);

  const allLines = (rows ?? []) as unknown as CostLineJoinRow[];
  const lines = allLines.filter((l) => {
    if (!l.request) return false;
    if (category && l.request.category !== category) return false;
    if (projectId && l.request.project_id !== projectId) return false;
    return true;
  });

  const totalCost = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  const byCostCategory = new Map<string, number>();
  const byRequestCategory = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byCoordinator = new Map<string, number>();

  for (const l of lines) {
    const amount = Number(l.amount) || 0;
    byCostCategory.set(l.cost_category, (byCostCategory.get(l.cost_category) ?? 0) + amount);

    if (l.request) {
      byRequestCategory.set(
        l.request.category,
        (byRequestCategory.get(l.request.category) ?? 0) + amount
      );

      const projectName = l.request.linked_project
        ? l.request.linked_project.deleted_at
          ? "Unavailable Project"
          : l.request.linked_project.name
        : l.request.project ?? "No project";
      byProject.set(projectName, (byProject.get(projectName) ?? 0) + amount);

      const coordinatorName = l.request.owner?.full_name ?? "Unassigned";
      byCoordinator.set(coordinatorName, (byCoordinator.get(coordinatorName) ?? 0) + amount);
    }
  }

  const costCategoryItems = (["materials", "labor", "transport", "other"] as CostCategory[]).map(
    (c) => ({
      label: COST_CATEGORY_LABELS[c],
      value: Math.round((byCostCategory.get(c) ?? 0) * 100) / 100,
    })
  );

  const requestCategoryItems = CATEGORIES.filter((c) => !category || c === category).map((c) => ({
    label: CATEGORY_LABELS[c],
    value: Math.round((byRequestCategory.get(c) ?? 0) * 100) / 100,
  }));

  const projectItems = Array.from(byProject.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }));

  const coordinatorItems = Array.from(byCoordinator.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }));

  const csvHref = `/api/reports/cost/csv?from=${from}&to=${to}&category=${category}&project=${projectId}`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="cost" profile={profile} />

      <form
        method="get"
        className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4"
      >
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
        <StatCard label="Total cost" value={totalCost.toFixed(2)} />
        <StatCard label="Cost lines" value={lines.length} />
        <StatCard label="Date range" value={`${from} → ${to}`} />
      </div>

      <div className="grid sm:grid-cols-2 gap-6 mb-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">By cost category</h2>
          <BarList items={costCategoryItems} />
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">By request type</h2>
          <BarList items={requestCategoryItems} barColor="#0f172a" />
        </section>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Top projects by cost</h2>
          {projectItems.length > 0 ? (
            <BarList items={projectItems} />
          ) : (
            <p className="text-sm text-slate-400">No cost data for this range yet.</p>
          )}
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Top coordinators by cost</h2>
          {coordinatorItems.length > 0 ? (
            <BarList items={coordinatorItems} barColor="#0f172a" />
          ) : (
            <p className="text-sm text-slate-400">No cost data for this range yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
