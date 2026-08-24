import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatStatusLabel,
  statusColor,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
} from "@/lib/types";
import { getWorkflowStages } from "@/lib/cachedLookups";
import Link from "next/link";
import {
  format,
  isPast,
  isToday,
  isFuture,
  parseISO,
  endOfDay,
  differenceInCalendarDays,
  subDays,
} from "date-fns";
import { DashboardDateFilter } from "./DashboardDateFilter";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;
  const isCoordinator = profile.role === "logistics_coordinator";
  const isTechnician = profile.role === "technician";

  // Coordinator and technician dashboards below are period-scoped: every
  // card reflects requests/jobs whose date_required falls in this window,
  // rather than all-time totals. Defaults to the trailing 30 days when no
  // ?from=/&to= is present. The "previous period" is the same length,
  // immediately preceding -- used for the trend arrows on the top cards.
  const params = await searchParams;
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultFromIso = subDays(new Date(), 29).toISOString().slice(0, 10);
  const periodFrom = params.from || defaultFromIso;
  const periodTo = params.to || todayIso;
  const periodLengthDays =
    differenceInCalendarDays(parseISO(periodTo), parseISO(periodFrom)) + 1;
  const prevPeriodTo = format(subDays(parseISO(periodFrom), 1), "yyyy-MM-dd");
  const prevPeriodFrom = format(
    subDays(parseISO(prevPeriodTo), periodLengthDays - 1),
    "yyyy-MM-dd"
  );
  const inPeriod = (dateStr: string | null) =>
    !!dateStr && dateStr >= periodFrom && dateStr <= periodTo;
  const inPrevPeriod = (dateStr: string | null) =>
    !!dateStr && dateStr >= prevPeriodFrom && dateStr <= prevPeriodTo;

  // Technicians never submit requests themselves (the generic !isStaff
  // branch below filters by requestor_id, which is always empty for
  // them), so they get their own dashboard entirely: jobs currently
  // assigned to them, not requests they raised.
  if (isTechnician) {
    // A job now has a crew, not one assigned_technician_id -- fetched via
    // request_technicians (see migration 020) instead of a direct filter
    // on requests. "Counts for everyone assigned" (this dashboard's
    // scoring included) falls out naturally: each crew member has their
    // own row here regardless of who else is on the job. assigned_at /
    // accepted_at come from this same join row -- they're per-crew-member
    // timestamps, not on the request itself.
    type TechJob = {
      id: string;
      request_number: string;
      title: string;
      category: string;
      status: string;
      priority: string;
      date_required: string | null;
      updated_at: string;
      assigned_at: string;
      accepted_at: string | null;
    };

    const [{ data: myJobRows }, stageList] = await Promise.all([
      supabase
        .from("request_technicians")
        .select(
          "assigned_at, accepted_at, request:requests(id, request_number, title, category, status, priority, date_required, updated_at)"
        )
        .eq("technician_id", profile.id),
      getWorkflowStages(),
    ]);

    const jobs = (myJobRows ?? [])
      .map((r) => {
        const req = r.request as unknown as Omit<TechJob, "assigned_at" | "accepted_at"> | null;
        if (!req) return null;
        return { ...req, assigned_at: r.assigned_at, accepted_at: r.accepted_at } as TechJob;
      })
      .filter((r): r is TechJob => r !== null)
      .sort((a, b) => {
        if (!a.date_required && !b.date_required) return 0;
        if (!a.date_required) return 1;
        if (!b.date_required) return -1;
        return new Date(a.date_required).getTime() - new Date(b.date_required).getTime();
      });
    const isTerminal = (category: string, statusKey: string) =>
      stageList.find((s) => s.category === category && s.key === statusKey)?.is_terminal ??
      false;

    // Every card below is scoped to jobs whose due date falls in the
    // selected period (see periodFrom/periodTo above), so "Total assigned"
    // etc. read as "assigned in period" rather than all-time totals.
    const cohort = jobs.filter((r) => inPeriod(r.date_required));
    const prevCohort = jobs.filter((r) => inPrevPeriod(r.date_required));
    const cohortCompleted = cohort.filter((r) => ["completed", "closed"].includes(r.status));
    const prevCohortCompleted = prevCohort.filter((r) => ["completed", "closed"].includes(r.status));

    const dueToday = cohort.filter(
      (r) => r.date_required && isToday(parseISO(r.date_required)) && !isTerminal(r.category, r.status)
    );
    const dueSoon = cohort.filter(
      (r) =>
        r.date_required &&
        !isTerminal(r.category, r.status) &&
        !isToday(parseISO(r.date_required)) &&
        isFuture(parseISO(r.date_required)) &&
        differenceInCalendarDays(parseISO(r.date_required), new Date()) <= 7
    );

    // SLA score: turnaround from when the job was handed to this
    // technician (assigned_at) to when they closed it out (the closeout
    // signature, signed_at), measured against the same due date the
    // request already carries. A job that closes at or before that
    // "promised" window scores 100; one that overruns scores
    // target/actual -- the more it overruns, the lower the score. Uses
    // assigned_at rather than the request's own date_requested (unlike
    // the coordinator dashboard's SLA score) because a technician doesn't
    // own the time the request spent in approval before reaching them.
    let slaScore: number | null = null;
    let avgTurnaroundDays: number | null = null;
    let avgPromisedDays: number | null = null;
    let acceptanceHours: number | null = null;
    if (cohortCompleted.length > 0) {
      const { data: closeouts } = await supabase
        .from("request_closeouts")
        .select("request_id, signed_at")
        .in(
          "request_id",
          cohortCompleted.map((r) => r.id)
        );
      const signedAtByRequest = new Map((closeouts ?? []).map((c) => [c.request_id, c.signed_at]));
      const scored: { score: number; actualDays: number; targetDays: number }[] = [];
      for (const r of cohortCompleted) {
        const signedAt = signedAtByRequest.get(r.id);
        if (!signedAt || !r.date_required) continue;
        const actualDays = differenceInCalendarDays(parseISO(signedAt), parseISO(r.assigned_at));
        if (actualDays < 0) continue;
        const targetDays = differenceInCalendarDays(parseISO(r.date_required), parseISO(r.assigned_at));
        const score =
          actualDays <= 0 || actualDays <= targetDays
            ? 100
            : Math.max(0, Math.min(100, (targetDays / actualDays) * 100));
        scored.push({ score, actualDays, targetDays });
      }
      if (scored.length > 0) {
        slaScore = Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length);
        avgTurnaroundDays =
          Math.round((scored.reduce((a, b) => a + b.actualDays, 0) / scored.length) * 10) / 10;
        avgPromisedDays =
          Math.round((scored.reduce((a, b) => a + b.targetDays, 0) / scored.length) * 10) / 10;
      }
    }

    const acceptedJobs = cohort.filter((r) => r.accepted_at);
    if (acceptedJobs.length > 0) {
      const hours = acceptedJobs.map(
        (r) => (parseISO(r.accepted_at as string).getTime() - parseISO(r.assigned_at).getTime()) / 3_600_000
      );
      acceptanceHours = Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10;
    }

    const completionRate = cohort.length > 0 ? cohortCompleted.length / cohort.length : null;
    // Needs a minimum sample before a percentage means anything -- one
    // job either completed or not swings the number from 0% to 100%.
    const hasEnoughData = cohort.length >= 3;
    const overallScore =
      hasEnoughData && completionRate !== null
        ? Math.round(0.7 * completionRate * 100 + 0.3 * (slaScore ?? completionRate * 100))
        : null;

    const categoryMix = CATEGORIES_ORDER.map((c) => ({
      key: c,
      label: CATEGORY_LABELS[c],
      count: cohort.filter((r) => r.category === c).length,
    }));
    const priorityMix = PRIORITIES_ORDER.map((p) => ({
      key: p,
      label: PRIORITY_LABELS[p],
      count: cohort.filter((r) => r.priority === p).length,
    }));

    const metrics = [
      {
        label: "Assigned in period",
        value: cohort.length,
        prevValue: prevCohort.length,
      },
      { label: "Due today", value: dueToday.length },
      { label: "Due soon (7 days)", value: dueSoon.length },
      {
        label: "Completed in period",
        value: cohortCompleted.length,
        prevValue: prevCohortCompleted.length,
      },
    ];

    return (
      <div className="p-8 max-w-6xl">
        <DashboardHeader
          name={profile.full_name.split(" ")[0]}
          from={periodFrom}
          to={periodTo}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {metrics.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <DonutCard
            title="Completed vs pending"
            total={cohort.length}
            completedCount={cohortCompleted.length}
            pendingCount={cohort.length - cohortCompleted.length}
          />
          <SlaScoreCard
            score={slaScore}
            sublabel={
              avgTurnaroundDays !== null
                ? `Avg ${avgTurnaroundDays}d assign-to-close vs ${avgPromisedDays}d promised.`
                : "Not enough completed jobs yet."
            }
          />
          <PerformanceRingCard
            title="Overall performance"
            value={overallScore}
            sublabel="70% completion + 30% SLA score."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <StatCard2
            title="Acceptance responsiveness"
            value={acceptanceHours}
            unit="hrs avg"
            sublabel={`Assigned to accepted, ${acceptedJobs.length} jobs.`}
          />
          <MixCard title="Category mix" segments={categoryMix} palette={CATEGORY_PALETTE} />
          <MixCard title="Priority mix" segments={priorityMix} palette={PRIORITY_PALETTE} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Today's Jobs</h2>
          {dueToday.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing due today.</p>
          ) : (
            <ul className="space-y-2">
              {dueToday.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {r.request_number} · {CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor(
                        r.category,
                        r.status,
                        stageList
                      )}`}
                    >
                      {formatStatusLabel(r.category, r.status, stageList)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

    // Coordinators only ever work requests that have been assigned to them
  // (owner_id), same "dedicated dashboard" treatment as technicians above
  // -- total/due-today/due-soon/completed-this-month, minus the Score card
  // since that was only requested for technicians.
  if (isCoordinator) {
    const [{ data: myRequests }, stageList] = await Promise.all([
      supabase
        .from("requests")
        .select(
          "id, request_number, title, category, status, priority, date_required, date_requested, updated_at, created_at"
        )
        .eq("owner_id", profile.id)
        .order("date_required", { ascending: true, nullsFirst: false }),
      getWorkflowStages(),
    ]);

    const myReqs = myRequests ?? [];
    const isTerminal = (category: string, statusKey: string) =>
      stageList.find((s) => s.category === category && s.key === statusKey)?.is_terminal ??
      false;

    // Every card below is scoped to requests whose due date falls in the
    // selected period (see periodFrom/periodTo above), so "Total assigned"
    // etc. read as "assigned in period" rather than all-time totals.
    const cohort = myReqs.filter((r) => inPeriod(r.date_required));
    const prevCohort = myReqs.filter((r) => inPrevPeriod(r.date_required));
    const cohortCompleted = cohort.filter((r) => ["completed", "closed"].includes(r.status));
    const prevCohortCompleted = prevCohort.filter((r) => ["completed", "closed"].includes(r.status));

    const dueToday = cohort.filter(
      (r) => r.date_required && isToday(parseISO(r.date_required)) && !isTerminal(r.category, r.status)
    );
    const dueSoon = cohort.filter(
      (r) =>
        r.date_required &&
        !isTerminal(r.category, r.status) &&
        !isToday(parseISO(r.date_required)) &&
        isFuture(parseISO(r.date_required)) &&
        differenceInCalendarDays(parseISO(r.date_required), new Date()) <= 7
    );

    // SLA score: turnaround from submission (date_requested) to closure
    // (updated_at) -- the same two fields and calendar-day methodology the
    // existing SLA/Turnaround report already uses -- measured against the
    // due date already set on the request. A request closed at or before
    // that window scores 100; one that overruns scores target/actual.
    let slaScore: number | null = null;
    let avgTurnaroundDays: number | null = null;
    let avgPromisedDays: number | null = null;
    const scored: { score: number; actualDays: number; targetDays: number }[] = [];
    for (const r of cohortCompleted) {
      if (!r.date_requested || !r.date_required) continue;
      const actualDays = differenceInCalendarDays(parseISO(r.updated_at), parseISO(r.date_requested));
      if (actualDays < 0) continue;
      const targetDays = differenceInCalendarDays(parseISO(r.date_required), parseISO(r.date_requested));
      const score =
        actualDays <= 0 || actualDays <= targetDays
          ? 100
          : Math.max(0, Math.min(100, (targetDays / actualDays) * 100));
      scored.push({ score, actualDays, targetDays });
    }
    if (scored.length > 0) {
      slaScore = Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length);
      avgTurnaroundDays =
        Math.round((scored.reduce((a, b) => a + b.actualDays, 0) / scored.length) * 10) / 10;
      avgPromisedDays =
        Math.round((scored.reduce((a, b) => a + b.targetDays, 0) / scored.length) * 10) / 10;
    }

    // Approval turnaround + return/reject rate both need to know each
    // cohort request's status history -- fetched once and reused for both.
    let approvalHours: number | null = null;
    let approvalSampleSize = 0;
    let returnRejectRate: number | null = null;
    let returnRejectCount = 0;
    if (cohort.length > 0) {
      const { data: historyRows } = await supabase
        .from("status_history")
        .select("request_id, status, changed_at")
        .in(
          "request_id",
          cohort.map((r) => r.id)
        );
      const rows = historyRows ?? [];
      const approvedAtByRequest = new Map<string, string>();
      const returnedSet = new Set<string>();
      const completedSet = new Set<string>();
      for (const h of rows) {
        if (h.status === "approved") {
          const existing = approvedAtByRequest.get(h.request_id);
          if (!existing || h.changed_at < existing) approvedAtByRequest.set(h.request_id, h.changed_at);
        }
        if (h.status === "returned_for_info") returnedSet.add(h.request_id);
        if (h.status === "completed") completedSet.add(h.request_id);
      }

      const approvalHoursList = cohort
        .filter((r) => approvedAtByRequest.has(r.id))
        .map(
          (r) =>
            (parseISO(approvedAtByRequest.get(r.id) as string).getTime() -
              parseISO(r.created_at).getTime()) /
            3_600_000
        )
        .filter((h) => h >= 0);
      approvalSampleSize = approvalHoursList.length;
      if (approvalHoursList.length > 0) {
        approvalHours =
          Math.round((approvalHoursList.reduce((a, b) => a + b, 0) / approvalHoursList.length) * 10) / 10;
      }

      // A request counts as returned/rejected if it was ever sent back for
      // info, or if it's closed without ever having passed through
      // "completed" first -- a manager rejecting a request outright closes
      // it directly (see rejectRequestClosed), skipping completion, since
      // there's no separate "rejected" status in active use (see the
      // Requests filter's dead-status cleanup).
      returnRejectCount = cohort.filter(
        (r) => returnedSet.has(r.id) || (r.status === "closed" && !completedSet.has(r.id))
      ).length;
      returnRejectRate = Math.round((returnRejectCount / cohort.length) * 100);
    }

    const completionRate = cohort.length > 0 ? cohortCompleted.length / cohort.length : null;
    const hasEnoughData = cohort.length >= 3;
    const overallScore =
      hasEnoughData && completionRate !== null
        ? Math.round(0.7 * completionRate * 100 + 0.3 * (slaScore ?? completionRate * 100))
        : null;

    const priorityMix = PRIORITIES_ORDER.map((p) => ({
      key: p,
      label: PRIORITY_LABELS[p],
      count: cohort.filter((r) => r.priority === p).length,
    }));

    const metrics = [
      {
        label: "Assigned in period",
        value: cohort.length,
        prevValue: prevCohort.length,
      },
      { label: "Due today", value: dueToday.length },
      { label: "Due soon (7 days)", value: dueSoon.length },
      {
        label: "Completed in period",
        value: cohortCompleted.length,
        prevValue: prevCohortCompleted.length,
      },
    ];

    return (
      <div className="p-8 max-w-6xl">
        <DashboardHeader
          name={profile.full_name.split(" ")[0]}
          from={periodFrom}
          to={periodTo}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {metrics.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <DonutCard
            title="Completed vs pending"
            total={cohort.length}
            completedCount={cohortCompleted.length}
            pendingCount={cohort.length - cohortCompleted.length}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <StatCard2
            title="Approval turnaround"
            value={approvalHours}
            unit="hrs avg"
            sublabel={`Submitted to approved, ${approvalSampleSize} requests.`}
          />
          <PercentCard
            title="Return / reject rate"
            value={returnRejectRate}
            danger
            sublabel={`${returnRejectCount} of ${cohort.length} returned for info or rejected.`}
          />
          <MixCard title="Priority mix" segments={priorityMix} palette={PRIORITY_PALETTE} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Today's Requests</h2>
          {dueToday.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing due today.</p>
          ) : (
            <ul className="space-y-2">
              {dueToday.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {r.request_number} · {CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor(
                        r.category,
                        r.status,
                        stageList
                      )}`}
                    >
                      {formatStatusLabel(r.category, r.status, stageList)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

    // Only select the columns the dashboard actually renders. Requestor/owner
  // names aren't shown anywhere on this page, so the joins that used to
  // pull them in were pure wasted payload on every single dashboard load.
  let query = supabase
    .from("requests")
    .select(
      "id, request_number, title, category, status, priority, date_required, updated_at, owner_id, requestor_id"
    );

  if (!isStaff) {
    query = query.eq("requestor_id", profile.id);
  }

  const [{ data: requests }, stageList] = await Promise.all([
    query.order("created_at", { ascending: false }),
    getWorkflowStages(),
  ]);

  const all = requests ?? [];

  // "Terminal" (no further action needed) is now admin-configured per
  // category/stage instead of a hardcoded status list.
  const isTerminal = (category: string, statusKey: string) =>
    stageList.find((s) => s.category === category && s.key === statusKey)?.is_terminal ?? false;

  const open = all.filter((r) => !isTerminal(r.category, r.status));
  const pendingApproval = all.filter(
    (r) => r.status === "submitted" || r.status === "under_review"
  );
  const overdue = all.filter(
    (r) =>
      r.date_required &&
      isPast(parseISO(r.date_required)) &&
      !isToday(parseISO(r.date_required)) &&
      !isTerminal(r.category, r.status)
  );
  // "Completed this month" specifically tracks the successful-completion
  // keys from the default pipeline. If a category's workflow is heavily
  // restructured with different terminal keys, this metric may need a
  // matching update.
  const completedThisMonth = all.filter((r) => {
    if (!["completed", "closed"].includes(r.status)) return false;
    const d = parseISO(r.updated_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const dueSoon = all
    .filter((r) => r.date_required && !isTerminal(r.category, r.status))
    .sort(
      (a, b) =>
        new Date(a.date_required!).getTime() - new Date(b.date_required!).getTime()
    )
    .slice(0, 6);

  const needsAttention = profile.is_manager
    ? all
        .filter(
          (r) =>
            r.status === "submitted" || r.status === "under_review" || r.status === "returned_for_info"
        )
        .slice(0, 6)
    : all.filter((r) => r.status === "returned_for_info").slice(0, 6);

  const assignedToMe = isCoordinator
    ? all.filter((r) => r.owner_id === profile.id && !isTerminal(r.category, r.status)).slice(0, 6)
    : [];

  const metrics = [
    { label: "Open Requests", value: open.length },
    { label: "Pending Approval", value: pendingApproval.length },
    { label: "Overdue", value: overdue.length, danger: overdue.length > 0 },
    { label: "Completed this month", value: completedThisMonth.length },
  ];

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          {isStaff ? "Dashboard" : "My Dashboard"}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Welcome back, {profile.full_name.split(" ")[0]}.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <p className="text-xs text-slate-500">{m.label}</p>
            <p
              className={`text-2xl font-semibold mt-1 ${
                m.danger ? "text-red-600" : "text-slate-900"
              }`}
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {isCoordinator && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Assigned to me</h2>
          {assignedToMe.length === 0 ? (
            <p className="text-sm text-slate-400">No requests assigned to you right now.</p>
          ) : (
            <ul className="space-y-2">
              {assignedToMe.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {r.request_number} · {CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor(
                        r.category,
                        r.status,
                        stageList
                      )}`}
                    >
                      {formatStatusLabel(r.category, r.status, stageList)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            {profile.is_manager ? "Needs Your Attention" : isStaff ? "Needs Attention" : "Returned to You"}
          </h2>
          {needsAttention.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing here right now.</p>
          ) : (
            <ul className="space-y-2">
              {needsAttention.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {r.request_number} · {CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor(
                        r.category,
                        r.status,
                        stageList
                      )}`}
                    >
                      {formatStatusLabel(r.category, r.status, stageList)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Due Soon</h2>
          {dueSoon.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing due right now.</p>
          ) : (
            <ul className="space-y-2">
              {dueSoon.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        Due {format(parseISO(r.date_required!), "MMM d, yyyy")}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                        PRIORITY_COLORS[r.priority as keyof typeof PRIORITY_COLORS]
                      }`}
                    >
                      {r.priority}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Shared dashboard KPI building blocks -- used by both the coordinator and
// technician branches above, so the two dashboards look and behave
// identically apart from which metrics they compute.
// ============================================================

const CATEGORIES_ORDER = ["delivery", "labor", "maintenance", "procurement"] as const;
const PRIORITIES_ORDER = ["low", "medium", "high", "urgent"] as const;
const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Priority bars reuse the same hue family as PRIORITY_COLORS elsewhere in
// the app (slate/blue/orange/red) at a stronger, bar-visible saturation.
// Category bars use a distinct set of hues so the two mix cards never look
// like they're encoding the same thing when shown side by side.
const PRIORITY_PALETTE: Record<string, string> = {
  low: "bg-slate-300",
  medium: "bg-blue-400",
  high: "bg-orange-400",
  urgent: "bg-red-400",
};
const CATEGORY_PALETTE: Record<string, string> = {
  delivery: "bg-indigo-400",
  labor: "bg-teal-400",
  maintenance: "bg-amber-400",
  procurement: "bg-pink-400",
};

function DashboardHeader({ name, from, to }: { name: string; from: string; to: string }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Welcome back, {name}.</p>
      </div>
      <div className="pt-1">
        <DashboardDateFilter from={from} to={to} />
      </div>
    </div>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  return (
    <span className={`text-[11px] font-normal ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function MetricCard({
  label,
  value,
  prevValue,
}: {
  label: string;
  value: number;
  prevValue?: number;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold mt-1 text-slate-900 flex items-baseline gap-2">
        {value}
        {prevValue !== undefined && <TrendBadge current={value} previous={prevValue} />}
      </p>
    </div>
  );
}

function DonutCard({
  title,
  total,
  completedCount,
  pendingCount,
}: {
  title: string;
  total: number;
  completedCount: number;
  pendingCount: number;
}) {
  const r = 32;
  const circumference = 2 * Math.PI * r;
  const completedLen = total > 0 ? circumference * (completedCount / total) : 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <div className="flex items-center gap-4">
        <div className="relative w-[72px] h-[72px] shrink-0">
          <svg width="72" height="72" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={r} fill="none" stroke="#fde68a" strokeWidth="9" />
            {total > 0 && (
              <circle
                cx="38"
                cy="38"
                r={r}
                fill="none"
                stroke="#10b981"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${completedLen} ${circumference}`}
                transform="rotate(-90 38 38)"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900">
            {total}
          </div>
        </div>
        <div className="text-xs text-slate-600 space-y-1.5">
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {completedCount} completed
          </p>
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />
            {pendingCount} pending
          </p>
        </div>
      </div>
    </div>
  );
}

function SlaScoreCard({ score, sublabel }: { score: number | null; sublabel: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">SLA score</p>
      <p className="text-2xl font-semibold text-slate-900 mb-2">{score !== null ? `${score}%` : "—"}</p>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">{sublabel}</p>
    </div>
  );
}

function PerformanceRingCard({
  title,
  value,
  sublabel,
}: {
  title: string;
  value: number | null;
  sublabel: string;
}) {
  const r = 32;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - (value ?? 0) / 100);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <div className="flex items-center gap-4">
        <div className="relative w-[72px] h-[72px] shrink-0">
          <svg width="72" height="72" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={r} fill="none" stroke="#e2e8f0" strokeWidth="9" />
            {value !== null && (
              <circle
                cx="38"
                cy="38"
                r={r}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 38 38)"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900">
            {value !== null ? `${value}%` : "—"}
          </div>
        </div>
        <p className="text-xs text-slate-400">{value !== null ? sublabel : "Not enough data yet."}</p>
      </div>
    </div>
  );
}

function StatCard2({
  title,
  value,
  unit,
  sublabel,
}: {
  title: string;
  value: number | null;
  unit: string;
  sublabel: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <p className="text-2xl font-semibold text-slate-900 mb-2">
        {value !== null ? value : "—"} <span className="text-sm font-normal text-slate-500">{unit}</span>
      </p>
      <p className="text-xs text-slate-400">{sublabel}</p>
    </div>
  );
}

function PercentCard({
  title,
  value,
  sublabel,
  danger,
}: {
  title: string;
  value: number | null;
  sublabel: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <p className="text-2xl font-semibold text-slate-900 mb-2">{value !== null ? `${value}%` : "—"}</p>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${danger ? "bg-red-400" : "bg-emerald-500"}`}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">{sublabel}</p>
    </div>
  );
}

function MixCard({
  title,
  segments,
  palette,
}: {
  title: string;
  segments: { key: string; label: string; count: number }[];
  palette: Record<string, string>;
}) {
  const total = segments.reduce((a, b) => a + b.count, 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <div className="h-2.5 rounded-full overflow-hidden flex mb-3 bg-slate-100">
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              className={palette[s.key] ?? "bg-slate-300"}
              style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%` }}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-slate-600">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${palette[s.key] ?? "bg-slate-300"}`} />
            {s.label} {s.count}
          </span>
        ))}
      </div>
    </div>
  );
}
