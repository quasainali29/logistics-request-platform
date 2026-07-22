import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import { formatStatusLabel, CATEGORY_LABELS, type Category } from "@/lib/types";
import { csvResponse } from "@/lib/csv";

export async function GET(req: NextRequest) {
  await requireReportPermission("view_report_throughput");

  const sp = req.nextUrl.searchParams;
  const { from, to } = parseDateRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  const category = sp.get("category") || "";
  const projectId = sp.get("project") || "";

  const supabase = await createClient();
  const stages = await getWorkflowStages();

  let query = supabase
    .from("requests")
    .select("request_number, title, category, status, date_requested")
    .gte("date_requested", from)
    .lte("date_requested", to)
    .order("date_requested", { ascending: false });
  if (category) query = query.eq("category", category);
  if (projectId) query = query.eq("project_id", projectId);

  const { data } = await query;
  const rows = (data ?? []) as {
    request_number: string;
    title: string;
    category: string;
    status: string;
    date_requested: string;
  }[];

  return csvResponse(
    `throughput-report-${from}-to-${to}.csv`,
    ["Request #", "Title", "Category", "Status", "Date Requested"],
    rows.map((r) => [
      r.request_number,
      r.title,
      CATEGORY_LABELS[r.category as Category] ?? r.category,
      formatStatusLabel(r.category, r.status, stages),
      r.date_requested,
    ])
  );
}
