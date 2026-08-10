"use client";

import { useState, useTransition, useRef, type ChangeEvent } from "react";
import {
  updateRequestStatus,
  addComment,
  approveAndAssignRequest,
  rejectRequest,
  rejectRequestClosed,
  assignTechnician,
  unassignTechnician,
  reassignCoordinator,
  unassignCoordinator,
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
  category,
}: {
  requestId: string;
  coordinators: { id: string; full_name: string }[];
  category?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [showAssign, setShowAssign] = useState(false);
  const [coordinatorId, setCoordinatorId] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectClose, setShowRejectClose] = useState(false);
  const [rejectCloseReason, setRejectCloseReason] = useState("");

  // Every category requires a reason before a request can be returned to
  // the requestor — enforced here via a mandatory popup.
  function handleRejectClick() {
    setShowReject(true);
  }

  function handleConfirmReject() {
    if (!rejectReason.trim()) return;
    startTransition(() => {
      rejectRequest(requestId, rejectReason.trim());
      setShowReject(false);
    });
  }

  // "Reject" (as opposed to "Return for info" above) closes the request
  // outright -- no rework loop, the requestor can't resubmit. Also requires
  // a mandatory reason, which is posted as a comment.
  function handleConfirmRejectClose() {
    if (!rejectCloseReason.trim()) return;
    startTransition(() => {
      rejectRequestClosed(requestId, rejectCloseReason.trim());
      setShowRejectClose(false);
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
        onClick={handleRejectClick}
        className="rounded-md px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
      >
        Return for info
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowRejectClose(true)}
        className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:opacity-90 transition disabled:opacity-50"
      >
        Reject
      </button>

      {showReject && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Return for info
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              This request will be sent back to the requestor as &ldquo;Returned for
              Info&rdquo;. A reason is required — the requestor can resubmit the same
              request once it&rsquo;s addressed.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason for returning this request…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason("");
                }}
                className="rounded-md px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !rejectReason.trim()}
                onClick={handleConfirmReject}
                className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectClose && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-red-600 mb-1">
              Reject this request
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              This closes the request immediately — the requestor cannot
              resubmit. A reason is required and will be posted as a
              comment.
            </p>
            <textarea
              value={rejectCloseReason}
              onChange={(e) => setRejectCloseReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejecting this request…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRejectClose(false);
                  setRejectCloseReason("");
                }}
                className="rounded-md px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !rejectCloseReason.trim()}
                onClick={handleConfirmRejectClose}
                className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Rejecting…" : "Reject & close"}
              </button>
            </div>
          </div>
        </div>
      )}

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

// Coordinator/manager picks a technician for a request that's already
// theirs -- moves it to "Assigned" and emails the technician. Modeled on
// ApproveRejectControls' popup pattern above.
export function AssignTechnicianControl({
  requestId,
  technicians,
  mode = "assign",
  currentTechnicianName = null,
}: {
  requestId: string;
  technicians: { id: string; full_name: string }[];
  mode?: "assign" | "reassign";
  currentTechnicianName?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [showAssign, setShowAssign] = useState(false);
  const [technicianId, setTechnicianId] = useState("");

  const isReassign = mode === "reassign";

  function handleAssign() {
    if (!technicianId) return;
    startTransition(() => {
      assignTechnician(requestId, technicianId);
      setShowAssign(false);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowAssign(true)}
        className={
          isReassign
            ? "rounded-md px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            : "rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition disabled:opacity-50"
        }
      >
        {isReassign ? "Reassign Technician" : "Assign Technician"}
      </button>

      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              {isReassign ? "Reassign to a different technician" : "Assign a technician"}
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              {isReassign ? (
                <>
                  {currentTechnicianName ? `${currentTechnicianName} will be removed from this job. ` : ""}
                  The request moves back to &ldquo;Assigned&rdquo; and the newly
                  selected technician will be notified by email to accept the job.
                </>
              ) : (
                <>
                  This request will move to &ldquo;Assigned&rdquo; and the selected
                  technician will be notified by email to accept the job.
                </>
              )}
            </p>
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">Select a technician…</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
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
                disabled={pending || !technicianId}
                onClick={handleAssign}
                className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Assigning…" : isReassign ? "Confirm & Reassign" : "Confirm & Assign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function UnassignTechnicianControl({
  requestId,
  currentTechnicianName = null,
}: {
  requestId: string;
  currentTechnicianName?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  function handleUnassign() {
    startTransition(() => {
      unassignTechnician(requestId);
      setShowConfirm(false);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowConfirm(true)}
        className="rounded-md px-4 py-2 text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
      >
        Unassign Technician
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Remove {currentTechnicianName ?? "this technician"} from this job?
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              The request moves back to &ldquo;Team Assigned&rdquo;. No email is sent.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-md px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleUnassign}
                className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Removing…" : "Unassign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Manager-only reassign/unassign for the coordinator owning a request --
// same popup pattern as AssignTechnicianControl/UnassignTechnicianControl
// above, but for owner_id instead of assigned_technician_id, and gated to
// managers only (coordinators can't reassign themselves or each other).
export function ReassignCoordinatorControl({
  requestId,
  coordinators,
  currentCoordinatorName = null,
}: {
  requestId: string;
  coordinators: { id: string; full_name: string }[];
  currentCoordinatorName?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [showAssign, setShowAssign] = useState(false);
  const [coordinatorId, setCoordinatorId] = useState("");

  function handleReassign() {
    if (!coordinatorId) return;
    startTransition(() => {
      reassignCoordinator(requestId, coordinatorId);
      setShowAssign(false);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowAssign(true)}
        className="rounded-md px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
      >
        Reassign Coordinator
      </button>

      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Reassign to a different coordinator
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              {currentCoordinatorName ? `${currentCoordinatorName} will be removed from this request. ` : ""}
              The newly selected coordinator will be notified by email.
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
                onClick={handleReassign}
                className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Reassigning…" : "Confirm & Reassign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function UnassignCoordinatorControl({
  requestId,
  currentCoordinatorName = null,
}: {
  requestId: string;
  currentCoordinatorName?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  function handleUnassign() {
    startTransition(() => {
      unassignCoordinator(requestId);
      setShowConfirm(false);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowConfirm(true)}
        className="rounded-md px-4 py-2 text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
      >
        Unassign Coordinator
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Remove {currentCoordinatorName ?? "this coordinator"} from this request?
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              The request moves back to &ldquo;Approved&rdquo;. No email is sent.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-md px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleUnassign}
                className="rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Removing…" : "Unassign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// The mention picker lists every active account regardless of role or
// department -- not just logistics staff -- since anyone in the org might
// need to be pulled into a request thread.
export function CommentBox({
  requestId,
  users,
}: {
  requestId: string;
  users: { id: string; full_name: string }[];
}) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredUsers = showMentions
    ? users
        .filter((u) => u.full_name.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
    : [];

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    const caret = e.target.selectionStart ?? next.length;
    const atIndex = next.lastIndexOf("@", caret - 1);
    if (atIndex === -1) {
      setShowMentions(false);
      return;
    }
    const between = next.slice(atIndex + 1, caret);
    if (/\s/.test(between)) {
      setShowMentions(false);
      return;
    }
    setMentionStart(atIndex);
    setMentionQuery(between);
    setShowMentions(true);
  }

  function selectMention(user: { id: string; full_name: string }) {
    if (mentionStart === null) return;
    const caret = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    setValue(`${before}@${user.full_name} ${after}`);
    setShowMentions(false);
    inputRef.current?.focus();
  }

  // Longest names first so "Bilal Ahmed" matches before a shorter "Bilal"
  // could shadow it.
  function extractMentionedIds(text: string): string[] {
    return [...users]
      .sort((a, b) => b.full_name.length - a.full_name.length)
      .filter((u) => text.includes(`@${u.full_name}`))
      .map((u) => u.id);
  }

  function handlePost() {
    if (!value.trim()) return;
    const mentionedIds = extractMentionedIds(value);
    startTransition(async () => {
      await addComment(requestId, value, mentionedIds);
      setValue("");
    });
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onBlur={() => setTimeout(() => setShowMentions(false), 150)}
          placeholder="Add a comment… (type @ to tag someone)"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          disabled={pending || !value.trim()}
          onClick={handlePost}
          className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Post
        </button>
      </div>

      {showMentions && filteredUsers.length > 0 && (
        <div className="absolute z-10 top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {filteredUsers.map((u) => (
            <button
              type="button"
              key={u.id}
              onMouseDown={(e) => {
                e.preventDefault();
                selectMention(u);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-900"
            >
              {u.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
