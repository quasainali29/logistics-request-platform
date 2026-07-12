import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
  type RequestStatus,
} from "@/lib/types";
import Link from "next/link";
import { format, isPast, isToday, parseISO } from "date-fns";

const OPEN_STATUSES: RequestStatus[] = [
  "submitted",
  "under_review",
  "returned_for_info",
  "approved",
  "planning",
  "assigned",
  "dispatched",
  "on_site",
];

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;

  let query = supabase
    .from("requests")
    .select("*, requestor:profiles!requests_requestor_id_fkey(full_name)");

  if (!isStaff) {
    query = query.eq("requestor_id", profile.id);
  }

  const { data: requests } = await query.order("created_at", { ascending: false });
  const all = requests ?? [];

  const open = all.filter((r) => OPEN_STATUSES.includes(r.status));
  const pendingApproval = all.filter((r) => r.status === "under_review");
  const overdue = all.filter(
    (r) =>
      r.date_required &&
      isPast(parseISO(r.date_required)) &&
      !isToday(parseISO(r.date_required)) &&
      !["completed", "closed", "rejected"].includes(r.status)
  );
  const completedThisMonth = all.filter((r) => {
    if (!["completed", "closed"].includes(r.status)) return false;
    const d = parseISO(r.updated_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const dueSoon = all
    .filter(
      (r) =>
        r.date_required &&
        !["completed", "closed", "rejected"].includes(r.status)
    )
    .sort(
      (a, b) =>
        new Date(a.date_required!).getTime() - new Date(b.date_required!).getTime()
    )
    .slice(0, 6);

  const needsAttention = isStaff
    ? all.filter((r) => r.status === "under_review" || r.status === "returned_for_info").slice(0, 6)
    : all.filter((r) => r.status === "returned_for_info").slice(0, 6);

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

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            {isStaff ? "Needs Your Attention" : "Returned to You"}
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
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                        STATUS_COLORS[r.status as RequestStatus]
                      }`}
                    >
                      {STATUS_LABELS[r.status as RequestStatus]}
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
