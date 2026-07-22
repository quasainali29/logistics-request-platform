import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import type { Project, WorkflowStage } from "@/lib/types";
import { csvResponse } from "@/lib/csv";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

export async function GET() {
  await requireReportPermission("view_report_projects");

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

  return csvResponse(
    "projects-report.csv",
    ["Project", "Client", "Status", "Total Requests", "Open", "Completed/Closed"],
    projectList.map((p) => {
      const s = stats.get(p.id) ?? { total: 0, open: 0, done: 0 };
      return [
        p.deleted_at ? `${p.name} (inactive)` : p.name,
        p.client ?? "",
        p.status,
        s.total,
        s.open,
        s.done,
      ];
    })
  );
}
