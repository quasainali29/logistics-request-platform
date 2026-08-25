import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import type { WorkflowStage } from "@/lib/types";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { csvResponse } from "@/lib/csv";
import { scoreTurnaround, overallPerformanceScore } from "@/app/(app)/reports/_components/KpiCards";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

// CSV export for the Logistics Performance report (src/app/(app)/reports/
// performance/page.tsx). Mirrors whichever view is currently selected in
// the UI -- overall totals, or one row per coordinator/technician -- using
// the exact same aggregation as that page so the export always matches
// what's on screen.
export async function GET(req: NextRequest) {
  const profile = await requireReportPermission("view_report_coordinator");

  const sp = req.nextUrl.searchParams;
  const { from, to } = parseDateRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  const view = sp.get("view") === "coordinator" || sp.get("view") === "technician" ? sp.get("view") : "overall";

  const supabase = await createClient();
  const stages = await getWorkflowStages();

  const { data: reqRows } = await supabase
    .from("requests")
    .select(
      "id, category, status, priority, date_required, date_requested, updated_at, created_at, owner_id, owner:profiles!requests_owner_id_fkey(full_name)"
    )
    .gte("date_required", from)
    .lte("date_required", to);

  type ReqRow = {
    id: string;
    category: string;
    status: string;
    priority: string;
    date_required: string;
    date_requested: string;
    updated_at: string;
    created_at: string;
    owner_id: string | null;
    owner: { full_name: string } | null;
  };
  const requests = (reqRows ?? []) as unknown as ReqRow[];

  if (view === "overall") {
    const completed = requests.filter((r) => isTerminal(stages, r.category, r.status));
    const pendingCount = requests.length - completed.length;
    const scored: number[] = [];
    for (const r of completed) {
      if (!r.date_requested || !r.date_required) continue;
      const actualDays = differenceInCalendarDays(parseISO(r.updated_at), parseISO(r.date_requested));
      if (actualDays < 0) continue;
      const targetDays = differenceInCalendarDays(parseISO(r.date_required), parseISO(r.date_requested));
      scored.push(scoreTurnaround(actualDays, targetDays));
    }
    const slaScore = scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
    const completionRate = requests.length > 0 ? completed.length / requests.length : null;
    const overallScore = overallPerformanceScore(requests.length, completionRate, slaScore);

    return csvResponse(
      `logistics-performance-overall-${from}-to-${to}.csv`,
      ["Total requests", "Completed", "Pending", "SLA score", "Overall performance"],
      [[requests.length, completed.length, pendingCount, slaScore ?? "", overallScore ?? ""]]
    );
  }

  // Status history, needed by both drill-down views (approval turnaround +
  // return/reject for coordinators; not used by technicians, but cheap
  // enough to compute once alongside the shared requests query).
  const returnedSet = new Set<string>();
  const completedViaHistorySet = new Set<string>();
  const approvedAtByRequest = new Map<string, string>();
  if (requests.length > 0) {
    const { data: historyRows } = await supabase
      .from("status_history")
      .select("request_id, status, changed_at")
      .in(
        "request_id",
        requests.map((r) => r.id)
      );
    for (const h of historyRows ?? []) {
      if (h.status === "approved") {
        const existing = approvedAtByRequest.get(h.request_id);
        if (!existing || h.changed_at < existing) approvedAtByRequest.set(h.request_id, h.changed_at);
      }
      if (h.status === "returned_for_info") returnedSet.add(h.request_id);
      if (h.status === "completed") completedViaHistorySet.add(h.request_id);
    }
  }

  if (view === "coordinator") {
    type OwnerAgg = {
      name: string;
      total: number;
      completed: number;
      scores: number[];
      approvalHours: number[];
      returnRejectCount: number;
    };
    const byOwner = new Map<string, OwnerAgg>();
    for (const r of requests) {
      const key = r.owner_id ?? "unassigned";
      const name = r.owner?.full_name ?? "Unassigned";
      const agg =
        byOwner.get(key) ?? { name, total: 0, completed: 0, scores: [], approvalHours: [], returnRejectCount: 0 };
      agg.total += 1;
      const done = isTerminal(stages, r.category, r.status);
      if (done) {
        agg.completed += 1;
        if (r.date_requested && r.date_required) {
          const actualDays = differenceInCalendarDays(parseISO(r.updated_at), parseISO(r.date_requested));
          if (actualDays >= 0) {
            const targetDays = differenceInCalendarDays(parseISO(r.date_required), parseISO(r.date_requested));
            agg.scores.push(scoreTurnaround(actualDays, targetDays));
          }
        }
      }
      const approvedAt = approvedAtByRequest.get(r.id);
      if (approvedAt) {
        const hours = (parseISO(approvedAt).getTime() - parseISO(r.created_at).getTime()) / 3_600_000;
        if (hours >= 0) agg.approvalHours.push(hours);
      }
      if (returnedSet.has(r.id) || (r.status === "closed" && !completedViaHistorySet.has(r.id))) {
        agg.returnRejectCount += 1;
      }
      byOwner.set(key, agg);
    }

    const rows = Array.from(byOwner.values())
      .map((agg) => {
        const slaScore = agg.scores.length
          ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length)
          : null;
        const approvalAvg = agg.approvalHours.length
          ? Math.round((agg.approvalHours.reduce((a, b) => a + b, 0) / agg.approvalHours.length) * 10) / 10
          : null;
        const completionRate = agg.total > 0 ? agg.completed / agg.total : null;
        const overall = overallPerformanceScore(agg.total, completionRate, slaScore);
        const returnRejectPct = agg.total > 0 ? Math.round((agg.returnRejectCount / agg.total) * 100) : null;
        return { ...agg, slaScore, approvalAvg, returnRejectPct, overall };
      })
      .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

    return csvResponse(
      `logistics-performance-by-coordinator-${from}-to-${to}.csv`,
      ["Coordinator", "Total", "Completed", "Pending", "SLA score", "Approval turnaround (hrs)", "Return/reject rate", "Overall performance"],
      rows.map((o) => [
        o.name,
        o.total,
        o.completed,
        o.total - o.completed,
        o.slaScore ?? "",
        o.approvalAvg ?? "",
        o.returnRejectPct ?? "",
        o.overall ?? "",
      ])
    );
  }

  // view === "technician"
  const { data: jobRows } = await supabase
    .from("request_technicians")
    .select(
      "technician_id, assigned_at, accepted_at, technician:profiles!request_technicians_technician_id_fkey(full_name), request:requests(id, category, status, date_required)"
    );

  type JobRow = {
    technician_id: string;
    assigned_at: string;
    accepted_at: string | null;
    technician: { full_name: string } | null;
    request: { id: string; category: string; status: string; date_required: string | null } | null;
  };
  const allJobs = (jobRows ?? []) as unknown as JobRow[];
  const cohortJobs = allJobs.filter(
    (j) => j.request?.date_required && j.request.date_required >= from && j.request.date_required <= to
  );

  const completedJobs = cohortJobs.filter((j) => j.request && isTerminal(stages, j.request.category, j.request.status));
  const closeoutMap = new Map<string, string>();
  if (completedJobs.length > 0) {
    const { data: closeouts } = await supabase
      .from("request_closeouts")
      .select("request_id, signed_at")
      .in(
        "request_id",
        completedJobs.map((j) => j.request!.id)
      );
    for (const c of closeouts ?? []) closeoutMap.set(c.request_id, c.signed_at);
  }

  type TechAgg = { name: string; total: number; completed: number; scores: number[]; acceptHours: number[] };
  const byTech = new Map<string, TechAgg>();
  for (const j of cohortJobs) {
    if (!j.request) continue;
    const key = j.technician_id;
    const name = j.technician?.full_name ?? "Unknown";
    const agg = byTech.get(key) ?? { name, total: 0, completed: 0, scores: [], acceptHours: [] };
    agg.total += 1;
    const done = isTerminal(stages, j.request.category, j.request.status);
    if (done) {
      agg.completed += 1;
      const signedAt = closeoutMap.get(j.request.id);
      if (signedAt && j.request.date_required) {
        const actualDays = differenceInCalendarDays(parseISO(signedAt), parseISO(j.assigned_at));
        if (actualDays >= 0) {
          const targetDays = differenceInCalendarDays(parseISO(j.request.date_required), parseISO(j.assigned_at));
          agg.scores.push(scoreTurnaround(actualDays, targetDays));
        }
      }
    }
    if (j.accepted_at) {
      const hours = (parseISO(j.accepted_at).getTime() - parseISO(j.assigned_at).getTime()) / 3_600_000;
      if (hours >= 0) agg.acceptHours.push(hours);
    }
    byTech.set(key, agg);
  }

  const rows = Array.from(byTech.values())
    .map((agg) => {
      const slaScore = agg.scores.length ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length) : null;
      const acceptAvg = agg.acceptHours.length
        ? Math.round((agg.acceptHours.reduce((a, b) => a + b, 0) / agg.acceptHours.length) * 10) / 10
        : null;
      const completionRate = agg.total > 0 ? agg.completed / agg.total : null;
      const overall = overallPerformanceScore(agg.total, completionRate, slaScore);
      return { ...agg, slaScore, acceptAvg, overall };
    })
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  return csvResponse(
    `logistics-performance-by-technician-${from}-to-${to}.csv`,
    ["Technician", "Total", "Completed", "Pending", "SLA score", "Acceptance responsiveness (hrs)", "Overall performance"],
    rows.map((t) => [t.name, t.total, t.completed, t.total - t.completed, t.slaScore ?? "", t.acceptAvg ?? "", t.overall ?? ""])
  );
}
