import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { Department } from "@/lib/types";
import { createDepartment } from "./actions";
import { DeleteDepartmentButton } from "./actions-client";
import { AdminNav } from "../AdminNav";

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, "manage_departments")) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const supabase = await createClient();

  // Soft-deleted departments are left out of this list entirely -- there's
  // no restore action, so once deleted they only live on as whatever
  // plain-text value already-submitted requests stored.
  const { data: departments } = await supabase
    .from("departments")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const departmentList = (departments ?? []) as Department[];

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage users, roles, workflow, and branding.
        </p>
      </div>

      <AdminNav active="departments" />

      <div className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3">
            {decodeURIComponent(error)}
          </div>
        )}

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Departments</h2>
          <p className="text-xs text-slate-500 mb-4">
            The department list shown on the New Request form. Add one here whenever a new
            department is added in the company -- it'll show up in the dropdown right away.
          </p>

          <div className="overflow-hidden border border-slate-200 rounded-lg mb-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Added</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departmentList.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No departments yet -- add one below.
                    </td>
                  </tr>
                ) : (
                  departmentList.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2.5 text-slate-900 font-medium">{d.name}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                        {format(parseISO(d.created_at), "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeleteDepartmentButton departmentId={d.id} departmentName={d.name} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <details className="group">
            <summary className="text-sm font-medium text-[var(--accent)] cursor-pointer list-none flex items-center gap-1">
              <span className="group-open:hidden">+ Add a department</span>
              <span className="hidden group-open:inline">Add a department</span>
            </summary>
            <form action={createDepartment} className="mt-4 flex gap-4 max-w-lg items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Finance"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <button
                  type="submit"
                  className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                >
                  Add Department
                </button>
              </div>
            </form>
          </details>
        </section>
      </div>
    </div>
  );
}
