"use client";

import { useState, useTransition } from "react";
import {
  assignUserRole,
  decideRoleRequest,
  deleteRole,
  updateRole,
  deactivateUser,
  reactivateUser,
  deleteUser,
  setUserPassword,
  sendPasswordResetEmail,
  setRolePermission,
} from "./actions";
import type { RoleRow } from "@/lib/types";
import { PROTECTED_ROLE_KEYS } from "@/lib/roleConstants";

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

// Renders one row of the Roles table, toggling between a static view and
// an inline edit form. Keyed by the caller (page.tsx) on every editable
// field's current value, so a successful save — which changes that data —
// naturally remounts this component with editing reset to false. A failed
// save (validation error) leaves the data untouched, so the component
// stays mounted with the edit form still open and the attempted values
// still showing, right alongside the error banner explaining why it
// didn't go through.
export function RoleTableRow({ role, isOwnRole }: { role: RoleRow; isOwnRole: boolean }) {
  const [editing, setEditing] = useState(false);
  const isProtected = PROTECTED_ROLE_KEYS.includes(role.name);

  if (!editing) {
    return (
      <tr>
        <td className="px-4 py-2.5">
          <p className="text-slate-900 font-medium">{role.label}</p>
          <p className="text-xs text-slate-400">{role.name}</p>
        </td>
        <td className="px-4 py-2.5 text-slate-600">{role.description ?? "—"}</td>
        <td className="px-4 py-2.5">
          {role.is_staff ? (
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
              Yes
            </span>
          ) : (
            <span className="text-xs text-slate-400">No</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          {role.is_manager ? (
            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
              Yes
            </span>
          ) : (
            <span className="text-xs text-slate-400">No</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--accent)] hover:underline mr-3"
          >
            Edit
          </button>
          <DeleteRoleButton roleName={role.name} />
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-slate-50">
      <td colSpan={5} className="px-4 py-4">
        <form action={updateRole.bind(null, role.name)} className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Display name</label>
            <input
              name="label"
              required
              defaultValue={role.label}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Internal key{isProtected && <span className="text-slate-400 font-normal"> (locked)</span>}
            </label>
            <input
              name="name"
              defaultValue={role.name}
              readOnly={isProtected}
              title={
                isProtected
                  ? "This key is referenced directly throughout the app and can't be changed."
                  : undefined
              }
              className={`w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                isProtected
                  ? "border-slate-200 bg-slate-100 text-slate-500"
                  : "border-slate-300"
              }`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <input
              name="description"
              defaultValue={role.description ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex items-center gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="is_staff"
                defaultChecked={role.is_staff}
                className="rounded border-slate-300"
              />
              Staff access (Fleet / Warehouse / Reports)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="is_manager"
                defaultChecked={role.is_manager}
                className="rounded border-slate-300"
              />
              Manager access (Admin panel, approvals)
            </label>
          </div>
          {isOwnRole && (
            <p className="text-xs text-amber-700 sm:col-span-2 -mt-1">
              This is your current role — unchecking Manager access here will be blocked, so you
              can't accidentally lock yourself out.
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              className="bg-[var(--accent)] text-white rounded-md px-4 py-1.5 text-sm font-medium hover:opacity-90 transition"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border border-slate-300 text-slate-700 rounded-md px-4 py-1.5 text-sm font-medium hover:bg-slate-50 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
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
          const password = prompt("Enter a new password for this user (min 6 characters):");
          if (!password) return;
          if (password.length < 6) {
            alert("Password must be at least 6 characters.");
            return;
          }
          startTransition(() => setUserPassword(userId, password));
        }}
        className="text-xs text-slate-700 hover:underline disabled:opacity-50"
      >
        Set Password
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm("Send this user a password reset link by email?")) {
            startTransition(() => sendPasswordResetEmail(userId));
          }
        }}
        className="text-xs text-blue-700 hover:underline disabled:opacity-50"
      >
        Email Reset Link
      </button>
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
