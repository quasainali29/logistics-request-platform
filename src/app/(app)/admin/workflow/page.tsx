import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Category, RoleRow, WorkflowStage, WorkflowTransition } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { AdminNav } from "../AdminNav";
import { createStage, updateStage, createTransition } from "./actions";
import { DeleteStageButton, DeleteTransitionButton } from "./actions-client";

const CATEGORIES: Category[] = ["delivery", "labor", "maintenance", "procurement"];

const COLOR_OPTIONS = [
  { value: "bg-slate-100 text-slate-700", label: "Slate" },
  { value: "bg-amber-100 text-amber-800", label: "Amber" },
  { value: "bg-orange-100 text-orange-800", label: "Orange" },
  { value: "bg-blue-100 text-blue-800", label: "Blue" },
  { value: "bg-indigo-100 text-indigo-800", label: "Indigo" },
  { value: "bg-purple-100 text-purple-800", label: "Purple" },
  { value: "bg-emerald-100 text-emerald-800", label: "Emerald" },
  { value: "bg-red-100 text-red-800", label: "Red" },
  { value: "bg-slate-200 text-slate-600", label: "Gray" },
];

export default async function WorkflowAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile.is_manager) redirect("/dashboard");

  const params = await searchParams;
  const category = (CATEGORIES.includes(params.category as Category)
    ? params.category
    : "delivery") as Category;

  const supabase = await createClient();
  const [{ data: stages }, { data: transitions }, { data: roles }] = await Promise.all([
    supabase
      .from("workflow_stages")
      .select("*")
      .eq("category", category)
      .order("sort_order", { ascending: true }),
    supabase
      .from("workflow_transitions")
      .select("*")
      .eq("category", category)
      .order("sort_order", { ascending: true }),
    supabase.from("roles").select("*").order("label", { ascending: true }),
  ]);

  const stageList = (stages ?? []) as WorkflowStage[];
  const transitionList = (transitions ?? []) as WorkflowTransition[];
  const roleList = (roles ?? []) as RoleRow[];

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage users, roles, workflow, and branding.
        </p>
      </div>

      <AdminNav active="workflow" />

      {params.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3 mb-6">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {CATEGORIES.map((c) => (
          <a
            key={c}
            href={`/admin/workflow?category=${c}`}
            className={`text-sm px-3 py-1.5 rounded-full border transition ${
              c === category
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {CATEGORY_LABELS[c]}
          </a>
        ))}
      </div>

      <div className="space-y-8">
        {/* Stages */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Stages — {CATEGORY_LABELS[category]}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            The statuses a {CATEGORY_LABELS[category].toLowerCase()} request can be in. Order
            controls display order; terminal stages count as &ldquo;done&rdquo; on dashboards.
          </p>

          <div className="overflow-x-auto border border-slate-200 rounded-lg mb-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Key</th>
                  <th className="text-left px-3 py-2 font-medium">Label</th>
                  <th className="text-left px-3 py-2 font-medium">Color</th>
                  <th className="text-left px-3 py-2 font-medium">Order</th>
                  <th className="text-left px-3 py-2 font-medium">Initial</th>
                  <th className="text-left px-3 py-2 font-medium">Terminal</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stageList.map((s) => (
                  <tr key={s.id}>
                    <td colSpan={7} className="p-0">
                      <form
                        action={updateStage}
                        className="grid grid-cols-[1fr_1.4fr_1.2fr_0.6fr_0.6fr_0.6fr_auto] gap-2 items-center px-3 py-2"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="category" value={category} />
                        <span className="text-xs text-slate-400 font-mono">{s.key}</span>
                        <input
                          name="label"
                          defaultValue={s.label}
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                        <select
                          name="color"
                          defaultValue={s.color}
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                        >
                          {COLOR_OPTIONS.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          name="sort_order"
                          defaultValue={s.sort_order}
                          className="rounded border border-slate-300 px-2 py-1 text-sm w-16"
                        />
                        <input
                          type="checkbox"
                          name="is_initial"
                          defaultChecked={s.is_initial}
                          className="rounded border-slate-300 justify-self-center"
                        />
                        <input
                          type="checkbox"
                          name="is_terminal"
                          defaultChecked={s.is_terminal}
                          className="rounded border-slate-300 justify-self-center"
                        />
                        <div className="flex items-center gap-3">
                          <button
                            type="submit"
                            className="text-xs text-[var(--accent)] font-medium hover:underline"
                          >
                            Save
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Delete buttons rendered separately since they aren't part of the Save form */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-5 -mt-2">
            {stageList.map((s) => (
              <div key={s.id} className="text-xs flex items-center gap-1">
                <span className="text-slate-400">{s.label}:</span>
                <DeleteStageButton stageId={s.id} category={category} stageLabel={s.label} />
              </div>
            ))}
          </div>

          <details className="group">
            <summary className="text-sm font-medium text-[var(--accent)] cursor-pointer list-none flex items-center gap-1">
              <span className="group-open:hidden">+ Add a stage</span>
              <span className="hidden group-open:inline">Add a stage</span>
            </summary>
            <form action={createStage} className="mt-4 grid sm:grid-cols-3 gap-4 max-w-3xl">
              <input type="hidden" name="category" value={category} />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Label</label>
                <input
                  name="label"
                  required
                  placeholder="e.g. Budget Review"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Key (auto from label if blank)
                </label>
                <input
                  name="key"
                  placeholder="budget_review"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Order</label>
                <input
                  type="number"
                  name="sort_order"
                  defaultValue={stageList.length}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Color</label>
                <select
                  name="color"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {COLOR_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 mt-6">
                <input type="checkbox" name="is_initial" className="rounded border-slate-300" />
                Initial stage
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 mt-6">
                <input type="checkbox" name="is_terminal" className="rounded border-slate-300" />
                Terminal (counts as done)
              </label>
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                >
                  Add Stage
                </button>
              </div>
            </form>
          </details>
        </section>

        {/* Transitions */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Transitions — {CATEGORY_LABELS[category]}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            The buttons that appear on a request, who can click them, and where they lead.
          </p>

          <div className="overflow-x-auto border border-slate-200 rounded-lg mb-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">From</th>
                  <th className="text-left px-3 py-2 font-medium">To</th>
                  <th className="text-left px-3 py-2 font-medium">Button</th>
                  <th className="text-left px-3 py-2 font-medium">Style</th>
                  <th className="text-left px-3 py-2 font-medium">Allowed roles</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transitionList.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 text-slate-600">{t.from_key}</td>
                    <td className="px-3 py-2 text-slate-600">{t.to_key}</td>
                    <td className="px-3 py-2 text-slate-900 font-medium">{t.label}</td>
                    <td className="px-3 py-2 text-slate-600">{t.variant}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {t.allowed_roles.length > 0 ? t.allowed_roles.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeleteTransitionButton transitionId={t.id} category={category} />
                    </td>
                  </tr>
                ))}
                {transitionList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      No transitions yet for this category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <details className="group">
            <summary className="text-sm font-medium text-[var(--accent)] cursor-pointer list-none flex items-center gap-1">
              <span className="group-open:hidden">+ Add a transition</span>
              <span className="hidden group-open:inline">Add a transition</span>
            </summary>
            <form action={createTransition} className="mt-4 space-y-4 max-w-3xl">
              <input type="hidden" name="category" value={category} />
              <div className="grid sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                  <select
                    name="from_key"
                    required
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    {stageList.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                  <select
                    name="to_key"
                    required
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    {stageList.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Button label
                  </label>
                  <input
                    name="label"
                    required
                    placeholder="e.g. Approve"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Style</label>
                  <select
                    name="variant"
                    defaultValue="primary"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="danger">Danger</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">
                  Who can click this button? (Managers can always act, regardless of selection.)
                </label>
                <div className="flex flex-wrap gap-3">
                  {roleList.map((r) => (
                    <label key={r.name} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="allowed_roles"
                        value={r.name}
                        className="rounded border-slate-300"
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
              >
                Add Transition
              </button>
            </form>
          </details>
        </section>
      </div>
    </div>
  );
}
