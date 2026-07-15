"use client";

import { useState, useTransition } from "react";
import {
  updateRequestStatus,
  addComment,
  approveAndAssignRequest,
  rejectRequest,
} from "../actions";

export function StatusButton({
  requestId,
  status,
  label,
  variant = "primary",
}: {
  requestId: string;
  status: string;
  label: string;
  variant?: "primary" | "danger" | "secondary";
}) {
  const [pending, startTransition] = useTransition();

  const styles = {
    primary: "bg-[var(--accent)] text-white hover:opacity-90",
    danger: "bg-red-600 text-white hover:opacity-90",
    secondary: "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50",
  }[variant];

  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => updateRequestStatus(requestId, status))}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles}`}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

export function ApproveRejectControls({
  requestId,
  coordinators,
}: {
  requestId: string;
  coordinators: { id: string; full_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [showAssign, setShowAssign] = useState(false);
  const [coordinatorId, setCoordinatorId] = useState("");

  function handleReject() {
    const reason = prompt("Optional reason for rejecting this request:");
    startTransition(() => {
      rejectRequest(requestId, reason?.trim() || undefined);
    });
  }

  function handleApprove() {
    if (!coordinatorId) return;
    startTransition(() => {
      approveAndAssignRequest(requestId, coordinatorId);
      setShowAssign(false);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowAssign(true)}
        className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={handleReject}
        className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:opacity-90 transition disabled:opacity-50"
      >
        Reject
      </button>

      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Assign to coordinator
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              This request will move to &ldquo;Under Process&rdquo; and the selected
              coordinator will be notified by email.
            </p>
            <select
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">Select a coordinator…</option>
              {coordinators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                className="rounded-md px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !coordinatorId}
                onClick={handleApprove}
                className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Assigning…" : "Confirm & Assign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CommentBox({ requestId }: { requestId: string }) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a comment…"
        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      />
      <button
        disabled={pending || !value.trim()}
        onClick={() =>
          startTransition(async () => {
            await addComment(requestId, value);
            setValue("");
          })
        }
        className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        Post
      </button>
    </div>
  );
}
