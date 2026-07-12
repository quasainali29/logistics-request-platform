import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatStatusLabel,
  statusColor,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
  type Priority,
  type Category,
  type WorkflowStage,
} from "@/lib/types";
import Link from "next/link";
import { format, parseISO } from "date-fns";

export default async function RequestsPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;

  let query = supabase
    .from("requests")
    .select("*, requestor:profiles!requests_requestor_id_fkey(full_name)");

  if (!isStaff) {
    query = query.eq("requestor_id", profile.id);
  }

  const [{ data: requests }, { data: stages }] = await Promise.all([
    query.order("created_at", { ascending: false }),
    supabase.from("workflow_stages").select("*"),
  ]);

  const stageList = (stages ?? []) as WorkflowStage[];

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Requests</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isStaff ? "All requests across the team." : "Requests you've submitted."}
          </p>
        </div>
        <Link
          href="/requests/new"
          className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          New Request
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Request</th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              {isStaff && <th className="text-left px-4 py-3 font-medium">Requestor</th>}
              <th className="text-left px-4 py-3 font-medium">Priority</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(requests ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/requests/${r.id}`} className="block">
                    <p className="text-slate-900 font-medium">{r.title}</p>
                    <p className="text-xs text-slate-500">{r.request_number}</p>
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {CATEGORY_LABELS[r.category as Category]}
                </td>
                {isStaff && (
                  <td className="px-4 py-3 text-slate-600">
                    {r.requestor?.full_name ?? "—"}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      PRIORITY_COLORS[r.priority as Priority]
                    }`}
                  >
                    {r.priority}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${statusColor(
                      r.category,
                      r.status,
                      stageList
                    )}`}
                  >
                    {formatStatusLabel(r.category, r.status, stageList)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.date_required ? format(parseISO(r.date_required), "MMM d, yyyy") : "—"}
                </td>
              </tr>
            ))}
            {(requests ?? []).length === 0 && (
              <tr>
                <td colSpan={isStaff ? 6 : 5} className="px-4 py-10 text-center text-slate-400">
                  No requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
