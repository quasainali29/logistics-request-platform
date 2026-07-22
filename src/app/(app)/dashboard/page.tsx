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
import { format, isPast, isToday, parseISO } from "date-fns";

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;
  const isCoordinator = profile.role === "logistics_coordinator";

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
