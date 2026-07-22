import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { Project } from "@/lib/types";
import { createProject } from "./actions";
import { ProjectStatusSelect, DeleteProjectButton } from "./actions-client";
import { AdminNav } from "../AdminNav";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, "manage_projects")) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const supabase = await createClient();

  // Soft-deleted projects are left out of this list entirely -- there's
  // no restore action, so once deleted they only live on as the
  // "Unavailable Project" label on whatever requests already linked them.
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const projectList = (projects ?? []) as Project[];

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage users, roles, workflow, and branding.
        </p>
      </div>

      <AdminNav active="projects" />

      <div className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3">
            {decodeURIComponent(error)}
          </div>
        )}

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Projects</h2>
          <p className="text-xs text-slate-500 mb-4">
            The project list requests link to on the New Request form. Anyone can still tag a
            request with a one-off "Other" project name that never shows up here -- add it below
            if it becomes a real, recurring project.
          </p>

          <div className="overflow-hidden border border-slate-200 rounded-lg mb-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Client</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Added</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      No projects yet -- add one below.
                    </td>
                  </tr>
                ) : (
                  projectList.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 text-slate-900 font-medium">{p.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{p.client ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <ProjectStatusSelect projectId={p.id} status={p.status} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">
                        {format(parseISO(p.created_at), "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeleteProjectButton projectId={p.id} projectName={p.name} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <details className="group">
            <summary className="text-sm font-medium text-[var(--accent)] cursor-pointer list-none flex items-center gap-1">
              <span className="group-open:hidden">+ Add a project</span>
              <span className="hidden group-open:inline">Add a project</span>
            </summary>
            <form action={createProject} className="mt-4 grid sm:grid-cols-3 gap-4 max-w-2xl">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Riverside Mall"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Client</label>
                <input
                  name="client"
                  placeholder="Optional"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select
                  name="status"
                  defaultValue="active"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <button
                  type="submit"
                  className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                >
                  Add Project
                </button>
              </div>
            </form>
          </details>
        </section>
      </div>
    </div>
  );
}
