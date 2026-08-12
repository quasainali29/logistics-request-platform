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
import { format, isPast, isToday, isFuture, parseISO, endOfDay, differenceInCalendarDays } from "date-fns";

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;
  const isCoordinator = profile.role === "logistics_coordinator";
  const isTechnician = profile.role === "technician";

  // Technicians never submit requests themselves (the generic !isStaff
  // branch below filters by requestor_id, which is always empty for
  // them), so they get their own dashboard entirely: jobs currently
  // assigned to them, not requests they raised.
  if (isTechnician) {
    // A job now has a crew, not one assigned_technician_id -- fetched via
    // request_technicians (see migration 020) instead of a direct filter
    // on requests. "Counts for everyone assigned" (this dashboard's
    // scoring included) falls out naturally: each crew member has their
    // own row here regardless of who else is on the job.
    type TechJob = {
      id: string;
      request_number: string;
      title: string;
      category: string;
      status: string;
      priority: string;
      date_required: string | null;
      updated_at: string;
    };

    const [{ data: myJobRows }, stageList] = await Promise.all([
      supabase
        .from("request_technicians")
        .select(
          "request:requests(id, request_number, title, category, status, priority, date_required, updated_at)"
        )
        .eq("technician_id", profile.id),
      getWorkflowStages(),
    ]);

    const jobs = (myJobRows ?? [])
      .map((r) => r.request as unknown as TechJob | null)
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

    const dueToday = jobs.filter(
      (r) => r.date_required && isToday(parseISO(r.date_required)) && !isTerminal(r.category, r.status)
    );
    const dueSoon = jobs.filter(
      (r) =>
        r.date_required &&
        !isTerminal(r.category, r.status) &&
        !isToday(parseISO(r.date_required)) &&
        isFuture(parseISO(r.date_required)) &&
        differenceInCalendarDays(parseISO(r.date_required), new Date()) <= 7
    );
    const completedThisMonth = jobs.filter((r) => {
      if (!["completed", "closed"].includes(r.status)) return false;
      const d = parseISO(r.updated_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // Score cohort: jobs due in the last 90 days -- currently-assigned
    // jobs only (the schema tracks who's assigned *now*, not a full
    // reassignment history), so a job moved to another technician before
    // completion simply drops out of both technicians' cohorts rather
    // than counting against whoever had it first.
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const scoreCohort = jobs.filter(
      (r) => r.date_required && parseISO(r.date_required) >= ninetyDaysAgo
    );
    const scoreCompleted = scoreCohort.filter((r) => ["completed", "closed"].includes(r.status));

    let onTimeCount = 0;
    if (scoreCompleted.length > 0) {
      const { data: closeouts } = await supabase
        .from("request_closeouts")
        .select("request_id, signed_at")
        .in(
          "request_id",
          scoreCompleted.map((r) => r.id)
        );
      const signedAtByRequest = new Map((closeouts ?? []).map((c) => [c.request_id, c.signed_at]));
      onTimeCount = scoreCompleted.filter((r) => {
        const signedAt = signedAtByRequest.get(r.id);
        if (!signedAt || !r.date_required) return false;
        return parseISO(signedAt) <= endOfDay(parseISO(r.date_required));
      }).length;
    }

    const completionRate = scoreCohort.length > 0 ? scoreCompleted.length / scoreCohort.length : null;
    const onTimeRate = scoreCompleted.length > 0 ? onTimeCount / scoreCompleted.length : null;
    // Needs a minimum sample before a percentage means anything -- one
    // job either completed or not swings the number from 0% to 100%.
    const hasEnoughData = scoreCohort.length >= 3;
    const score =
      hasEnoughData && completionRate !== null
        ? Math.round(0.7 * completionRate * 100 + 0.3 * (onTimeRate ?? completionRate) * 100)
        : null;

    const circumference = 2 * Math.PI * 38;
    const scoreOffset = circumference * (1 - (score ?? 0) / 100);

    const metrics = [
      { label: "Total jobs assigned", value: jobs.length },
      { label: "Due today", value: dueToday.length },
      { label: "Due soon (7 days)", value: dueSoon.length },
      { label: "Completed this month", value: completedThisMonth.length },
    ];

    return (
      <div className="p-8 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">My Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Welcome back, {profile.full_name.split(" ")[0]}.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {metrics.map((m) => (
            <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">{m.label}</p>
              <p className="text-2xl font-semibold mt-1 text-slate-900">{m.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-6">
            <div className="relative w-[88px] h-[88px] shrink-0">
              <svg width="88" height="88" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="38" fill="none" stroke="#e2e8f0" strokeWidth="9" />
                {score !== null && (
                  <circle
                    cx="44"
                    cy="44"
                    r="38"
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={scoreOffset}
                    transform="rotate(-90 44 44)"
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-slate-900">
                {score !== null ? `${score}%` : "—"}
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-1">Your Score</h2>
              {hasEnoughData ? (
                <>
                  <p className="text-sm text-slate-600">
                    {scoreCompleted.length} of {scoreCohort.length} jobs completed, {onTimeCount} on
                    time.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Based on completion rate and on-time delivery over the last 90 days.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  Not enough completed jobs yet to calculate a score.
                </p>
              )}
            </div>
          </div>
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
          "id, request_number, title, category, status, priority, date_required, updated_at"
        )
        .eq("owner_id", profile.id)
        .order("date_required", { ascending: true, nullsFirst: false }),
      getWorkflowStages(),
    ]);

    const myReqs = myRequests ?? [];
    const isTerminal = (category: string, statusKey: string) =>
      stageList.find((s) => s.category === category && s.key === statusKey)?.is_terminal ??
      false;

    const dueToday = myReqs.filter(
      (r) => r.date_required && isToday(parseISO(r.date_required)) && !isTerminal(r.category, r.status)
    );
    const dueSoon = myReqs.filter(
      (r) =>
        r.date_required &&
        !isTerminal(r.category, r.status) &&
        !isToday(parseISO(r.date_required)) &&
        isFuture(parseISO(r.date_required)) &&
        differenceInCalendarDays(parseISO(r.date_required), new Date()) <= 7
    );
    const completedThisMonth = myReqs.filter((r) => {
      if (!["completed", "closed"].includes(r.status)) return false;
      const d = parseISO(r.updated_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const metrics = [
      { label: "Total assigned", value: myReqs.length },
      { label: "Due today", value: dueToday.length },
      { label: "Due soon (7 days)", value: dueSoon.length },
      { label: "Completed this month", value: completedThisMonth.length },
    ];

    return (
      <div className="p-8 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">My Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Welcome back, {profile.full_name.split(" ")[0]}.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {metrics.map((m) => (
            <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">{m.label}</p>
              <p className="text-2xl font-semibold mt-1 text-slate-900">{m.value}</p>
            </div>
          ))}
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
