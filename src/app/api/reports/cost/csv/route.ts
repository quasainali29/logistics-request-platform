import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { parseDateRange } from "@/lib/reportDates";
import { CATEGORY_LABELS, COST_CATEGORY_LABELS, type Category } from "@/lib/types";
import { csvResponse } from "@/lib/csv";

interface CostLineJoinRow {
  cost_category: string;
  description: string | null;
  amount: number;
  created_at: string;
  request: {
    request_number: string;
    category: string;
    project_id: string | null;
    project: string | null;
    owner: { full_name: string } | null;
    linked_project: { name: string; deleted_at: string | null } | null;
  } | null;
}

export async function GET(request: Request) {
  await requireReportPermission("view_report_cost");

  const url = new URL(request.url);
  const { from, to } = parseDateRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  const category = url.searchParams.get("category") || "";
  const projectId = url.searchParams.get("project") || "";

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("request_cost_lines")
    .select(
      "cost_category, description, amount, created_at, request:requests!request_cost_lines_request_id_fkey(request_number, category, project_id, project, owner:profiles!requests_owner_id_fkey(full_name), linked_project:projects!requests_project_id_fkey(name, deleted_at))"
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

  return csvResponse(
    "cost-report.csv",
    ["Request #", "Request Type", "Project", "Coordinator", "Cost Category", "Description", "Amount", "Date"],
    lines.map((l) => {
      const projectName = l.request?.linked_project
        ? l.request.linked_project.deleted_at
          ? "Unavailable Project"
          : l.request.linked_project.name
        : l.request?.project ?? "";
      return [
        l.request?.request_number ?? "",
        l.request ? CATEGORY_LABELS[l.request.category as Category] : "",
        projectName,
        l.request?.owner?.full_name ?? "Unassigned",
        COST_CATEGORY_LABELS[l.cost_category] ?? l.cost_category,
        l.description ?? "",
        Number(l.amount).toFixed(2),
        l.created_at.slice(0, 10),
      ];
    })
  );
}
