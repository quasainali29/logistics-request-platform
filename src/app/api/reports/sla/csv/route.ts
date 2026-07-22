import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { CATEGORY_LABELS, formatStatusLabel, type Category, type WorkflowStage } from "@/lib/types";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { csvResponse } from "@/lib/csv";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

export async function GET(req: NextRequest) {
  await requireReportPermission("view_report_sla");

  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") || "";
  const today = new Date();

  const supabase = await createClient();
  const stages = await getWorkflowStages();

  let query = supabase
    .from("requests")
    .select(
      "request_number, title, category, status, date_required, owner:profiles!requests_owner_id_fkey(full_name)"
    )
    .not("date_required", "is", null)
    .lt("date_required", today.toISOString().slice(0, 10));
  if (category) query = query.eq("category", category);

  const { data } = await query;
  const rows = ((data ?? []) as unknown as {
    request_number: string;
    title: string;
    category: string;
    status: string;
    date_required: string;
    owner: { full_name: string } | null;
  }[]).filter((r) => !isTerminal(stages, r.category, r.status));

  return csvResponse(
    `sla-overdue-report-${today.toISOString().slice(0, 10)}.csv`,
    ["Request #", "Title", "Category", "Status", "Owner", "Due Date", "Days Overdue"],
    rows.map((r) => [
      r.request_number,
      r.title,
      CATEGORY_LABELS[r.category as Category] ?? r.category,
      formatStatusLabel(r.category, r.status, stages),
      r.owner?.full_name ?? "Unassigned",
      r.date_required,
      differenceInCalendarDays(today, parseISO(r.date_required)),
    ])
  );
}
