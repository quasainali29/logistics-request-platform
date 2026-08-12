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

// "Azhar" for one, "Azhar, Shahoalom" for two, "Azhar +2" for three or
// more -- keeps the column readable regardless of crew size.
function crewLabel(crew: RequestRow["request_technicians"]) {
  const names = (crew ?? []).map((c) => c.technician?.full_name).filter(Boolean) as string[];
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} +${names.length - 1}`;
}
import { deleteRequests } from "./actions";

export default function RequestsTable({
  requests,
  stageList,
  isStaff,
  isManager,
}: {
  requests: RequestRow[];
  stageList: WorkflowStage[];
  isStaff: boolean;
  isManager: boolean;
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
  function isOverdue(r: RequestRow) {
    if (!r.date_required) return false;
    const terminal =
      stageList.find((s) => s.category === r.category && s.key === r.status)?.is_terminal ??
      false;
    if (terminal) return false;
    const due = parseISO(r.date_required);
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
            {requests.map((r) => (
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
                  {r.owner?.full_name ?? <span className="text-slate-400">Not assigned</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {crewLabel(r.request_technicians) ?? (
                    <span className="text-slate-400">Not assigned</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.date_required ? (
                    isOverdue(r) ? (
                      <>
                        <p className="text-red-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {format(parseISO(r.date_required), "MMM d, yyyy")}
                        </p>
                        <p className="text-xs text-red-600">
                          {differenceInCalendarDays(new Date(), parseISO(r.date_required))} days
                          overdue
                        </p>
                      </>
                    ) : (
                      <span className="text-slate-600">
                        {format(parseISO(r.date_required), "MMM d, yyyy")}
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
            ))}
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
