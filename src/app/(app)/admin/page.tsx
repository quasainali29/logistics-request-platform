import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { Profile, RoleRow, RoleRequestRow } from "@/lib/types";
import { createRole } from "./actions";
import { RoleAssignSelect, DeleteRoleButton, RoleRequestDecisionButtons } from "./actions-client";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile.is_manager) redirect("/dashboard");

  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: roles }, { data: users }, { data: pendingRequests }] = await Promise.all([
    supabase.from("roles").select("*").order("created_at", { ascending: true }),
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase
      .from("role_requests")
      .select("*, user:profiles!role_requests_user_id_fkey(full_name, email)")
      .eq("status", "pending")
      .order("requested_at", { ascending: true }),
  ]);

  const roleList = (roles ?? []) as RoleRow[];
  const userList = (users ?? []) as Profile[];
  const requestList = (pendingRequests ?? []) as RoleRequestRow[];

  return (
    <div className="p-8 max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage roles, assign access, and approve role requests.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3">
          {decodeURIComponent(error)}
        </div>
      )}

      {/* Pending role requests */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Pending Role Requests</h2>
        <p className="text-xs text-slate-500 mb-4">
          Requests submitted by users from their Account page.
        </p>
        {requestList.length === 0 ? (
          <p className="text-sm text-slate-400">No pending requests.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requestList.map((r) => (
              <li key={r.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">
                    <span className="font-medium">{r.user?.full_name}</span> wants{" "}
                    <span className="font-medium">{r.requested_role}</span>
                  </p>
                  {r.note && <p className="text-xs text-slate-500 mt-0.5">&ldquo;{r.note}&rdquo;</p>}
                  <p className="text-xs text-slate-400 mt-0.5">
                    {format(parseISO(r.requested_at), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
                <RoleRequestDecisionButtons requestId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Roles */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Roles</h2>
        <p className="text-xs text-slate-500 mb-4">
          Define the roles people can be assigned. Staff access shows Fleet/Warehouse/Reports;
          manager access adds this Admin panel.
        </p>

        <div className="overflow-hidden border border-slate-200 rounded-lg mb-5">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Description</th>
                <th className="text-left px-4 py-2 font-medium">Staff</th>
                <th className="text-left px-4 py-2 font-medium">Manager</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roleList.map((r) => (
                <tr key={r.name}>
                  <td className="px-4 py-2.5">
                    <p className="text-slate-900 font-medium">{r.label}</p>
                    <p className="text-xs text-slate-400">{r.name}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{r.description ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {r.is_staff ? (
                      <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.is_manager ? (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DeleteRoleButton roleName={r.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="group">
          <summary className="text-sm font-medium text-[var(--accent)] cursor-pointer list-none flex items-center gap-1">
            <span className="group-open:hidden">+ Create a new role</span>
            <span className="hidden group-open:inline">Create a new role</span>
          </summary>
          <form action={createRole} className="mt-4 grid sm:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Display name
              </label>
              <input
                name="label"
                required
                placeholder="e.g. Regional Supervisor"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Internal key
              </label>
              <input
                name="name"
                placeholder="auto-generated from display name if blank"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Description
              </label>
              <input
                name="description"
                placeholder="What this role is for"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="flex items-center gap-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="is_staff" className="rounded border-slate-300" />
                Staff access (Fleet / Warehouse / Reports)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="is_manager" className="rounded border-slate-300" />
                Manager access (Admin panel, approvals)
              </label>
            </div>
            <div>
              <button
                type="submit"
                className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                Create Role
              </button>
            </div>
          </form>
        </details>
      </section>

      {/* Users */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Users</h2>
        <p className="text-xs text-slate-500 mb-4">
          Directly assign a role to any user — takes effect immediately, no approval needed.
        </p>
        <div className="overflow-hidden border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {userList.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5 text-slate-900">
                    {u.full_name}
                    {u.id === profile.id && (
                      <span className="text-xs text-slate-400 ml-1">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <RoleAssignSelect userId={u.id} currentRole={u.role} roles={roleList} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
