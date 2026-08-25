import { createClient } from "@/lib/supabase/server";
import { requireReportPermission } from "@/lib/reportAuth";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { parseDateRange } from "@/lib/reportDates";
import { CATEGORY_LABELS, type WorkflowStage } from "@/lib/types";
import { differenceInCalendarDays, parseISO, format } from "date-fns";
import Link from "next/link";
import { ReportsNav } from "../ReportsNav";
import { StatCard } from "../_components/StatCard";
import {
  CATEGORIES_ORDER,
  PRIORITIES_ORDER,
  PRIORITY_LABELS,
  PRIORITY_PALETTE,
  CATEGORY_PALETTE,
  DonutCard,
  SlaScoreCard,
  PerformanceRingCard,
  MixCard,
  scoreTurnaround,
  overallPerformanceScore,
} from "../_components/KpiCards";

type ViewMode = "overall" | "coordinator" | "technician";

function isTerminal(stages: WorkflowStage[], category: string, status: string) {
  return stages.some((s) => s.category === category && s.key === status && s.is_terminal);
}

const VIEW_TABS: { key: ViewMode; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "coordinator", label: "By coordinator" },
  { key: "technician", label: "By technician" },
];

// Merges the former "Coordinator Workload" report (migration 012 /
// view_report_coordinator) into one page alongside an org-wide overview
// and a technician breakdown -- all three views reuse the exact KPI
// building blocks and scoring methodology from the coordinator/technician
// dashboards (src/app/(app)/dashboard/page.tsx) via KpiCards.tsx, so the
// numbers here always agree with what a coordinator/technician sees on
// their own dashboard for the same date range.
export default async function PerformanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; view?: string }>;
}) {
  const profile = await requireReportPermission("view_report_coordinator");
  const params = await searchParams;
  const { from, to } = parseDateRange(params);
  const view: ViewMode =
    params.view === "coordinator" || params.view === "technician" ? params.view : "overall";

  const supabase = await createClient();
  const stages = await getWorkflowStages();

  // Org-wide request set for this date range, scoped by date_required
  // (due date) -- the same period-scoping convention the coordinator and
  // technician dashboards use, so "Overall" here always agrees with those
  // pages for the same range.
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

  const completed = requests.filter((r) => isTerminal(stages, r.category, r.status));
  const pendingCount = requests.length - completed.length;

  // Org-wide SLA score: submission (date_requested) to closure
  // (updated_at), measured against each request's own due date -- same
  // methodology as the coordinator dashboard's SLA score, applied across
  // every request in range rather than one owner's.
  const scored: { score: number; actualDays: number; targetDays: number }[] = [];
  for (const r of completed) {
    if (!r.date_requested || !r.date_required) continue;
    const actualDays = differenceInCalendarDays(parseISO(r.updated_at), parseISO(r.date_requested));
    if (actualDays < 0) continue;
    const targetDays = differenceInCalendarDays(parseISO(r.date_required), parseISO(r.date_requested));
    scored.push({ score: scoreTurnaround(actualDays, targetDays), actualDays, targetDays });
  }
  const slaScore =
    scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length) : null;
  const avgTurnaroundDays =
    scored.length > 0
      ? Math.round((scored.reduce((a, b) => a + b.actualDays, 0) / scored.length) * 10) / 10
      : null;
  const avgPromisedDays =
    scored.length > 0
      ? Math.round((scored.reduce((a, b) => a + b.targetDays, 0) / scored.length) * 10) / 10
      : null;

  const completionRate = requests.length > 0 ? completed.length / requests.length : null;
  const overallScore = overallPerformanceScore(requests.length, completionRate, slaScore);

  const categoryMix = CATEGORIES_ORDER.map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    count: requests.filter((r) => r.category === c).length,
  }));
  const priorityMix = PRIORITIES_ORDER.map((p) => ({
    key: p,
    label: PRIORITY_LABELS[p],
    count: requests.filter((r) => r.priority === p).length,
  }));

  // Status history for the cohort, reused for the org-wide return/reject
  // rate below and the per-coordinator breakdown further down -- fetched
  // once regardless of which view is active, since it's cheap and keeps
  // the "Overall" numbers always available even when a coordinator/
  // technician toggles between views.
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
  // A request counts as returned/rejected if it was ever sent back for
  // info, or if it's closed without ever having passed through
  // "completed" first -- see the identical comment in the coordinator
  // dashboard branch (dashboard/page.tsx) for why that's the right proxy.
  const returnRejectCount = requests.filter(
    (r) => returnedSet.has(r.id) || (r.status === "closed" && !completedViaHistorySet.has(r.id))
  ).length;
  const returnRejectRate =
    requests.length > 0 ? Math.round((returnRejectCount / requests.length) * 100) : null;

  const dayCount = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;
  const dateCaption = `${format(parseISO(from), "MMM d")} – ${format(parseISO(to), "MMM d")}`;

  // ---- Per-coordinator breakdown (computed only when that view is active) ----
  type OwnerAgg = {
    name: string;
    total: number;
    completed: number;
    scores: number[];
    approvalHours: number[];
    returnRejectCount: number;
  };
  type OwnerRow = OwnerAgg & {
    slaScore: number | null;
    approvalAvg: number | null;
    returnRejectPct: number | null;
    overall: number | null;
  };
  let ownerRows: OwnerRow[] = [];
  if (view === "coordinator") {
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

    ownerRows = Array.from(byOwner.values())
      .map((agg) => {
        const ownerSla = agg.scores.length
          ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length)
          : null;
        const approvalAvg = agg.approvalHours.length
          ? Math.round((agg.approvalHours.reduce((a, b) => a + b, 0) / agg.approvalHours.length) * 10) / 10
          : null;
        const ownerCompletionRate = agg.total > 0 ? agg.completed / agg.total : null;
        const overall = overallPerformanceScore(agg.total, ownerCompletionRate, ownerSla);
        return {
          ...agg,
          slaScore: ownerSla,
          approvalAvg,
          returnRejectPct: agg.total > 0 ? Math.round((agg.returnRejectCount / agg.total) * 100) : null,
          overall,
        };
      })
      .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
  }

  // ---- Per-technician breakdown (computed only when that view is active) ----
  type TechAgg = { name: string; total: number; completed: number; scores: number[]; acceptHours: number[] };
  type TechRow = TechAgg & { slaScore: number | null; acceptAvg: number | null; overall: number | null };
  let techRows: TechRow[] = [];
  if (view === "technician") {
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

    const completedJobs = cohortJobs.filter(
      (j) => j.request && isTerminal(stages, j.request.category, j.request.status)
    );
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

    techRows = Array.from(byTech.values())
      .map((agg) => {
        const techSla = agg.scores.length
          ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length)
          : null;
        const acceptAvg = agg.acceptHours.length
          ? Math.round((agg.acceptHours.reduce((a, b) => a + b, 0) / agg.acceptHours.length) * 10) / 10
          : null;
        const techCompletionRate = agg.total > 0 ? agg.completed / agg.total : null;
        const overall = overallPerformanceScore(agg.total, techCompletionRate, techSla);
        return { ...agg, slaScore: techSla, acceptAvg, overall };
      })
      .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
  }

  const csvHref = `/api/reports/performance/csv?from=${from}&to=${to}&view=${view}`;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="performance" profile={profile} />

      <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-4">
        <input type="hidden" name="view" value={view} />
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
        <button
          type="submit"
          className="bg-[var(--accent)] text-white rounded-md px-4 py-1.5 text-sm font-medium hover:opacity-90 transition"
        >
          Apply
        </button>
        <a href={csvHref} className="ml-auto text-sm text-[var(--accent)] font-medium hover:opacity-80">
          Export CSV
        </a>
      </form>

      <div className="flex gap-2 mb-6">
        {VIEW_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reports/performance?from=${from}&to=${to}&view=${t.key}`}
            className={`text-sm px-3 py-1.5 rounded-md border transition ${
              view === t.key
                ? "bg-[var(--bg-accent,#eef2ff)] border-[var(--accent)] text-[var(--accent)] font-medium"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "overall" && (
        <>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard label="Total requests" value={requests.length} caption={dateCaption} />
            <StatCard label="Completed" value={completed.length} />
            <StatCard label="Pending" value={pendingCount} />
            <StatCard
              label="Return / reject rate"
              value={returnRejectRate !== null ? `${returnRejectRate}%` : "—"}
              tone={returnRejectRate !== null && returnRejectRate > 20 ? "danger" : "default"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <DonutCard
              title="Completed vs pending"
              total={requests.length}
              completedCount={completed.length}
              pendingCount={pendingCount}
            />
            <SlaScoreCard
              score={slaScore}
              sublabel={
                avgTurnaroundDays !== null
                  ? `Avg turnaround ${avgTurnaroundDays}d vs ${avgPromisedDays}d promised.`
                  : "Not enough completed requests yet."
              }
            />
            <PerformanceRingCard
              title="Overall performance"
              value={overallScore}
              sublabel="70% completion + 30% SLA score."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <MixCard title="Category mix" segments={categoryMix} palette={CATEGORY_PALETTE} />
            <MixCard title="Priority mix" segments={priorityMix} palette={PRIORITY_PALETTE} />
          </div>

          <p className="text-xs text-slate-400">
            {dayCount} day range · {from} to {to}
          </p>
        </>
      )}

      {view === "coordinator" && (
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Performance by coordinator</h2>
          <p className="text-xs text-slate-500 mb-4">{dateCaption}</p>
          <div className="overflow-hidden border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium whitespace-nowrap">Coordinator</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Total</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Completed</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Pending</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">SLA score</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Approval turnaround</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Return / reject</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Overall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ownerRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                      No requests in this range.
                    </td>
                  </tr>
                ) : (
                  ownerRows.map((o) => (
                    <tr key={o.name}>
                      <td className="px-4 py-2.5 text-slate-900 font-medium whitespace-nowrap">{o.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-900">{o.total}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{o.completed}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600">{o.total - o.completed}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {o.slaScore !== null ? `${o.slaScore}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {o.approvalAvg !== null ? `${o.approvalAvg}h` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {o.returnRejectPct !== null ? `${o.returnRejectPct}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {o.overall !== null ? (
                          <span
                            className={`px-2 py-0.5 rounded-md ${
                              o.overall >= 70
                                ? "bg-emerald-50 text-emerald-700"
                                : o.overall >= 50
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-red-50 text-red-700"
                            }`}
                          >
                            {o.overall}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "technician" && (
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Performance by technician</h2>
          <p className="text-xs text-slate-500 mb-4">{dateCaption}</p>
          <div className="overflow-hidden border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium whitespace-nowrap">Technician</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Total</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Completed</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Pending</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">SLA score</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Acceptance responsiveness</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Overall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {techRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      No jobs in this range.
                    </td>
                  </tr>
                ) : (
                  techRows.map((t) => (
                    <tr key={t.name}>
                      <td className="px-4 py-2.5 text-slate-900 font-medium whitespace-nowrap">{t.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-900">{t.total}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{t.completed}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600">{t.total - t.completed}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {t.slaScore !== null ? `${t.slaScore}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {t.acceptAvg !== null ? `${t.acceptAvg}h` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {t.overall !== null ? (
                          <span
                            className={`px-2 py-0.5 rounded-md ${
                              t.overall >= 70
                                ? "bg-emerald-50 text-emerald-700"
                                : t.overall >= 50
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-red-50 text-red-700"
                            }`}
                          >
                            {t.overall}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
