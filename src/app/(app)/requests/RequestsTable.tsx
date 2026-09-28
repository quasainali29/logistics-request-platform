"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { format, parseISO, isPast, isToday, differenceInCalendarDays } from "date-fns";
import { AlertTriangle } from "lucide-react";
import {
  formatStatusLabel,
  statusColor,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
  type Priority,
  type Category,
  type WorkflowStage,
  type RequestRow,
} from "@/lib/types";
import {
  VERIFICATION_BUCKET_LABELS,
  VERIFICATION_BUCKET_COLORS,
  type CompletedVerificationBucket,
} from "@/lib/requestVerificationStatus";

// "Azhar" for one, "Azhar, Shahoalom" for two, "Azhar +2" for three or
// more -- keeps the column readable regardless of crew size.
function crewLabel(crew: RequestRow["request_technicians"]) {
  const names = (crew ?? []).map((c) => c.technician?.full_name).filter(Boolean) as string[];
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} +${names.length - 1}`;
}
import { deleteRequests } from "./actions";

// Overrides for the three statuses this list displays differently than
// the raw workflow_stages label/color -- see requests/page.tsx's
// statusOptions comment for why. "dispatched"/"on_site" collapse into one
// "Work in process" badge (purely cosmetic, the real status column value
// is untouched); "submitted" reads as "Unassigned"; "completed" is
// replaced by whichever of the three verificationBuckets sub-states this
// row is currently in (falls back to the plain "Completed" label if the
// bucket lookup somehow has nothing for this id, e.g. a race between page
// render and computeCompletedVerificationBuckets).
function displayStatus(
  r: RequestRow,
  stageList: WorkflowStage[],
  verificationBuckets: Record<string, CompletedVerificationBucket>
): { label: string; color: string } {
  if (r.status === "dispatched" || r.status === "on_site") {
    return { label: "Work in process", color: "bg-purple-100 text-purple-800" };
  }
  if (r.status === "completed") {
    const bucket = verificationBuckets[r.id];
    if (bucket) {
      return { label: VERIFICATION_BUCKET_LABELS[bucket], color: VERIFICATION_BUCKET_COLORS[bucket] };
    }
  }
  if (r.status === "submitted") {
    return { label: "Unassigned", color: statusColor(r.category, r.status, stageList) };
  }
  return {
    label: formatStatusLabel(r.category, r.status, stageList),
    color: statusColor(r.category, r.status, stageList),
  };
}

export default function RequestsTable({
  requests,
  stageList,
  isStaff,
  isManager,
  verificationBuckets,
}: {
  requests: RequestRow[];
  stageList: WorkflowStage[];
  isStaff: boolean;
  isManager: boolean;
  verificationBuckets: Record<string, CompletedVerificationBucket>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allSelected = requests.length > 0 && selected.size === requests.length;
  const someSelected = selected.size > 0 && !allSelected;

  const colCount = 8 + (isStaff ? 1 : 0) + (isManager ? 1 : 0);

  // Same definition the dashboard's "Overdue" metric uses: due date has
  // passed (not today), and the request hasn't reached a terminal stage
  // for its category -- a closed/completed/rejected request is never
  // flagged even if its due date is in the past.
  // "Due" is the Conclude by date, not Date required -- Conclude by is
  // when the job needs to be wrapped up, which is what "overdue" means.
  function isOverdue(r: RequestRow) {
    if (!r.conclude_date) return false;
    const terminal =
      stageList.find((s) => s.category === r.category && s.key === r.status)?.is_terminal ??
      false;
    if (terminal) return false;
    const due = parseISO(r.conclude_date);
    return isPast(due) && !isToday(due);
  }

  const selectedList = useMemo(() => Array.from(selected), [selected]);

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(requests.map((r) => r.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDeleteOne(id: string, label: string) {
    if (!confirm(`Delete request "${label}"? This can't be undone.`)) return;
    startTransition(() => {
      deleteRequests([id]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  function handleDeleteSelected() {
    if (selectedList.length === 0) return;
    if (
      !confirm(
        `Delete ${selectedList.length} selected request${
          selectedList.length > 1 ? "s" : ""
        }? This can't be undone.`
      )
    )
      return;
    startTransition(() => {
      deleteRequests(selectedList);
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-3">
      {isManager && selected.size > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          <p className="text-sm text-red-700">
            {selected.size} request{selected.size > 1 ? "s" : ""} selected
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={handleDeleteSelected}
            className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md px-3 py-1.5 disabled:opacity-50"
          >
            Delete selected
          </button>
        </div>
      )}

      {/* Horizontal scroll instead of squeezing columns -- this table has
          up to 7 columns (with the manager checkbox/actions columns) which
          never fits a phone width. */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              {isManager && (
                <th className="px-4 py-3 font-medium w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label="Select all requests"
                    className="rounded border-slate-300"
                  />
                </th>
              )}
              <th className="text-left px-4 py-3 font-medium">Request</th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium">Project</th>
              {isStaff && <th className="text-left px-4 py-3 font-medium">Requestor</th>}
              <th className="text-left px-4 py-3 font-medium">Priority</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Assigned coordinator</th>
              <th className="text-left px-4 py-3 font-medium">Assigned technician</th>
              <th className="text-left px-4 py-3 font-medium">Due</th>
              {isManager && <th className="text-left px-4 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((r) => {
              const status = displayStatus(r, stageList, verificationBuckets);
              return (
              <tr
                key={r.id}
                className={`hover:bg-slate-50 ${isOverdue(r) ? "bg-red-50" : ""}`}
              >
                {isManager && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      aria-label={`Select ${r.title}`}
                      className="rounded border-slate-300"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/requests/${r.id}`} className="block">
                    <p className="text-slate-900 font-medium">{r.title}</p>
                    <p className="text-xs text-slate-500">{r.request_number}</p>
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {CATEGORY_LABELS[r.category as Category]}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.linked_project?.name ?? r.project ?? "—"}
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
                  <span className={`text-xs px-2 py-0.5 rounded-full ${status.color}`}>
                    {status.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.owner?.full_name ?? <span className="text-slate-400">Not assigned</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {crewLabel(r.request_technicians) ?? (
                    <span className="text-slate-400">Not assigned</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.conclude_date ? (
                    isOverdue(r) ? (
                      <>
                        <p className="text-red-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {format(parseISO(r.conclude_date), "MMM d, yyyy")}
                        </p>
                        <p className="text-xs text-red-600">
                          {differenceInCalendarDays(new Date(), parseISO(r.conclude_date))} days
                          overdue
                        </p>
                      </>
                    ) : (
                      <span className="text-slate-600">
                        {format(parseISO(r.conclude_date), "MMM d, yyyy")}
                      </span>
                    )
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                {isManager && (
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleDeleteOne(r.id, r.title)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
            {requests.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-slate-400">
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
