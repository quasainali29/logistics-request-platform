"use client";

import { useTransition } from "react";
import { assignUserRole, decideRoleRequest, deleteRole } from "./actions";
import type { RoleRow } from "@/lib/types";

export function RoleAssignSelect({
  userId,
  currentRole,
  roles,
}: {
  userId: string;
  currentRole: string;
  roles: RoleRow[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={currentRole}
      disabled={pending}
      onChange={(e) => startTransition(() => assignUserRole(userId, e.target.value))}
      className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white disabled:opacity-50"
    >
      {roles.map((r) => (
        <option key={r.name} value={r.name}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

export function DeleteRoleButton({ roleName }: { roleName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (
          confirm(
            `Delete the "${roleName}" role? This only works if no one currently has it assigned.`
          )
        ) {
          startTransition(() => deleteRole(roleName));
        }
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  );
}

export function RoleRequestDecisionButtons({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      <button
        disabled={pending}
        onClick={() => startTransition(() => decideRoleRequest(requestId, "approved"))}
        className="rounded-md bg-[var(--accent)] text-white px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        disabled={pending}
        onClick={() => {
          const note = prompt("Optional note for the requestor (visible in their email):") || undefined;
          startTransition(() => decideRoleRequest(requestId, "rejected", note));
        }}
        className="rounded-md border border-slate-300 text-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
