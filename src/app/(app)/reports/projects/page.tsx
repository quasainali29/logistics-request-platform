import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import type { Project, WorkflowStage } from "@/lib/types";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

export default async function ProjectsReportPage() {
  const profile = await requireReportPermission("view_report_projects");

  const supabase = await createClient();
  const [{ data: projects }, stages] = await Promise.all([
    supabase.from("projects").select("*").order("name"),
    getWorkflowStages(),
  ]);

  const projectList = (projects ?? []) as Project[];
  const projectIds = projectList.map((p) => p.id);

  const { data: requestRows } = projectIds.length
    ? await supabase.from("requests").select("project_id, category, status").in("project_id", projectIds)
    : { data: [] };

  const rows = (requestRows ?? []) as { project_id: string; category: string; status: string }[];

  const stats = new Map<string, { total: number; open: number; done: number }>();
  for (const r of rows) {
    const s = stats.get(r.project_id) ?? { total: 0, open: 0, done: 0 };
    s.total += 1;
    if (isTerminal(stages, r.category, r.status)) s.done += 1;
    else s.open += 1;
    stats.set(r.project_id, s);
  }

  const totalRequests = rows.length;
  const csvHref = `/api/reports/projects/csv`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="projects" profile={profile} />

      <div className="flex justify-end mb-4">
        <a href={csvHref} className="text-sm text-[var(--accent)] font-medium hover:opacity-80">
          Export CSV
        </a>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Projects" value={projectList.length} />
        <StatCard label="Requests linked to a project" value={totalRequests} />
        <StatCard
          label="Active projects"
          value={projectList.filter((p) => !p.deleted_at).length}
        />
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Requests per project</h2>
        <div className="overflow-hidden border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Project</th>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Total requests</th>
                <th className="text-right px-4 py-2 font-medium">Open</th>
                <th className="text-right px-4 py-2 font-medium">Completed/Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projectList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    No projects yet.
                  </td>
                </tr>
              ) : (
                projectList.map((p) => {
                  const s = stats.get(p.id) ?? { total: 0, open: 0, done: 0 };
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 text-slate-900 font-medium">
                        {p.name}
                        {p.deleted_at && <span className="text-slate-400 font-normal"> (inactive)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{p.client ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 capitalize">{p.status.replace("_", " ")}</td>
                      <td className="px-4 py-2.5 text-right text-slate-900">{s.total}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600">{s.open}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{s.done}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
