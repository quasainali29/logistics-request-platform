import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { format, parseISO } from "date-fns";
import { formatRoleLabel, type RoleRow, type RoleRequestRow } from "@/lib/types";
import { requestRole } from "./actions";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: roles }, { data: myRequests }] = await Promise.all([
    supabase.from("roles").select("*").order("label", { ascending: true }),
    supabase
      .from("role_requests")
      .select("*")
      .eq("user_id", profile.id)
      .order("requested_at", { ascending: false }),
  ]);

  const roleList = (roles ?? []) as RoleRow[];
  const requestList = (myRequests ?? []) as RoleRequestRow[];
  const hasPending = requestList.some((r) => r.status === "pending");
  const assignableRoles = roleList.filter((r) => r.name !== profile.role);

  const statusStyles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My Account</h1>
        <p className="text-sm text-slate-500 mt-1">{profile.email}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3">
          {decodeURIComponent(error)}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Current Role</h2>
        <p className="text-sm text-slate-700">{formatRoleLabel(profile.role, roleList)}</p>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Request a Different Role</h2>
        <p className="text-xs text-slate-500 mb-4">
          A manager will review your request. You&apos;ll get an email once it&apos;s decided.
        </p>

        {hasPending ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            You already have a pending request — wait for it to be decided before submitting another.
          </p>
        ) : (
          <form action={requestRole} className="space-y-3">
            <select
              name="requested_role"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">Select a role…</option>
              {assignableRoles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.label}
                </option>
              ))}
            </select>
            <textarea
              name="note"
              placeholder="Why do you need this role? (optional)"
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button
              type="submit"
              className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
            >
              Submit Request
            </button>
          </form>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Request History</h2>
        {requestList.length === 0 ? (
          <p className="text-sm text-slate-400">No role requests yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requestList.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-900">{r.requested_role}</p>
                  <p className="text-xs text-slate-400">
                    {format(parseISO(r.requested_at), "MMM d, yyyy")}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusStyles[r.status]}`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
