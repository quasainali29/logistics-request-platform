"use client";

import { useTransition } from "react";
import {
  assignUserRole,
  decideRoleRequest,
  deleteRole,
  deactivateUser,
  reactivateUser,
  deleteUser,
  setRolePermission,
} from "./actions";
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

export function UserRowActions({
  userId,
  status,
}: {
  userId: string;
  status: "active" | "inactive";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      {status === "active" ? (
        <button
          disabled={pending}
          onClick={() => {
            if (confirm("Deactivate this user? They'll immediately lose the ability to sign in.")) {
              startTransition(() => deactivateUser(userId));
            }
          }}
          className="text-xs text-amber-700 hover:underline disabled:opacity-50"
        >
          Deactivate
        </button>
      ) : (
        <button
          disabled={pending}
          onClick={() => startTransition(() => reactivateUser(userId))}
          className="text-xs text-emerald-700 hover:underline disabled:opacity-50"
        >
          Reactivate
        </button>
      )}
      <button
        disabled={pending}
        onClick={() => {
          if (
            confirm(
              "Permanently delete this user? This can't be undone. If they have any request history, deletion will be blocked automatically — deactivate instead in that case."
            )
          ) {
            startTransition(() => deleteUser(userId));
          }
        }}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}

// One checkbox in the Roles & Permissions matrix. Toggling it fires the
// server action immediately (no separate save button) and greys out while
// in flight, mirroring RoleAssignSelect's instant-toggle pattern.
export function PermissionCheckbox({
  roleName,
  permissionKey,
  granted,
}: {
  roleName: string;
  permissionKey: string;
  granted: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <input
      type="checkbox"
      defaultChecked={granted}
      disabled={pending}
      onChange={(e) =>
        startTransition(() => setRolePermission(roleName, permissionKey, e.target.checked))
      }
      className="h-4 w-4 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)] disabled:opacity-50"
    />
  );
}
