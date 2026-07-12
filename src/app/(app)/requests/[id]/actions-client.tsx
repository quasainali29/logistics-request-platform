"use client";

import { useState, useTransition } from "react";
import { updateRequestStatus, addComment } from "../actions";

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
