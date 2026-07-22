import { Fragment } from "react";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPermissionMatrix } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { RoleRow } from "@/lib/types";
import { createPermission } from "../actions";
import { PermissionCheckbox } from "../actions-client";
import { AdminNav } from "../AdminNav";

export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  // access_admin_panel gets you into /admin at all; this page additionally
  // needs manage_roles_permissions since it can grant any access to anyone.
  if (!profile.is_manager && !can(profile, "manage_roles_permissions")) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: roles }, { permissions, cells }] = await Promise.all([
    supabase.from("roles").select("*").order("created_at", { ascending: true }),
    getPermissionMatrix(),
  ]);

  const roleList = (roles ?? []) as RoleRow[];

  // Group permissions by category, preserving the sort_order the catalog
  // was inserted/added with.
  const categories = Array.from(new Set(permissions.map((p) => p.category)));

  const grantedLookup = new Map<string, boolean>();
  for (const c of cells) {
    grantedLookup.set(`${c.role_name}::${c.permission_key}`, c.granted);
  }

  const existingCategories = Array.from(new Set(permissions.map((p) => p.category)));

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage users, roles, workflow, and branding.
        </p>
      </div>

      <AdminNav active="permissions" />

      <div className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3">
            {decodeURIComponent(error)}
          </div>
        )}

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Roles &amp; Permissions</h2>
          <p className="text-xs text-slate-500 mb-4">
            Check a box to grant that role the access in its row. New roles (created under Users
            &amp; Roles) and new permissions (added below) automatically appear here — nothing is
            ever a fixed list.
          </p>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium sticky left-0 bg-slate-50">
                    Access
                  </th>
                  {roleList.map((r) => (
                    <th key={r.name} className="text-center px-4 py-2 font-medium whitespace-nowrap">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((category) => (
                  <Fragment key={category}>
                    <tr className="bg-slate-50/60">
                      <td
                        colSpan={roleList.length + 1}
                        className="px-4 py-1.5 text-xs font-semibold text-slate-500 sticky left-0"
                      >
                        {category}
                      </td>
                    </tr>
                    {permissions
                      .filter((p) => p.category === category)
                      .map((p) => (
                        <tr key={p.key}>
                          <td className="px-4 py-2.5 text-slate-800 sticky left-0 bg-white whitespace-nowrap">
                            {p.label}
                          </td>
                          {roleList.map((r) => (
                            <td key={r.name} className="px-4 py-2.5 text-center">
                              <PermissionCheckbox
                                roleName={r.name}
                                permissionKey={p.key}
                                granted={grantedLookup.get(`${r.name}::${p.key}`) ?? false}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <details className="group mt-5">
            <summary className="text-sm font-medium text-[var(--accent)] cursor-pointer list-none flex items-center gap-1">
              <span className="group-open:hidden">+ Add a new permission</span>
              <span className="hidden group-open:inline">Add a new permission</span>
            </summary>
            <form action={createPermission} className="mt-4 grid sm:grid-cols-3 gap-4 max-w-3xl">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Display name
                </label>
                <input
                  name="label"
                  required
                  placeholder="e.g. Export data to CSV"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <input
                  name="category"
                  list="existing-categories"
                  placeholder="e.g. Reports"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <datalist id="existing-categories">
                  {existingCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Internal key
                </label>
                <input
                  name="key"
                  placeholder="auto-generated if blank"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div className="sm:col-span-3">
                <p className="text-xs text-slate-500 mb-2">
                  New rows start unchecked for every role — grant it above once it's added.
                </p>
                <button
                  type="submit"
                  className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                >
                  Add Permission
                </button>
              </div>
            </form>
          </details>
        </section>
      </div>
    </div>
  );
}
