import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import type { WorkflowStage } from "@/lib/types";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { csvResponse } from "@/lib/csv";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

export async function GET(req: NextRequest) {
  await requireReportPermission("view_report_coordinator");

  const sp = req.nextUrl.searchParams;
  const { from, to } = parseDateRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });

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

  return csvResponse(
    `coordinator-workload-${from}-to-${to}.csv`,
    ["Owner", "Total", "Open", "Completed/Closed", "Avg Turnaround (days)"],
    ownerRows.map((o) => [o.name, o.total, o.open, o.done, o.avgTurnaround ?? ""])
  );
}
