"use client";

import { useState, useTransition } from "react";
import { deleteDepartment, assignDepartmentManager, removeDepartmentManager } from "./actions";

// Lets an admin/manager see and edit which managers are scoped to this
// department -- a chip per assigned manager (with a remove button) plus a
// select to add another. `assignableManagers` is every profile with
// is_manager=true who isn't logistics_manager (that role already sees
// everything, so assigning it here would be a no-op) and isn't already
// assigned to this department.
export function DepartmentManagersEditor({
  departmentId,
  assignedManagers,
  assignableManagers,
}: {
  departmentId: string;
  assignedManagers: { id: string; full_name: string }[];
  assignableManagers: { id: string; full_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");

  const remaining = assignableManagers.filter(
    (m) => !assignedManagers.some((a) => a.id === m.id)
  );

  function handleAdd() {
    if (!selected) return;
    startTransition(() => assignDepartmentManager(departmentId, selected));
    setSelected("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignedManagers.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-full pl-2.5 pr-1 py-0.5"
        >
          {m.full_name}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() => removeDepartmentManager(departmentId, m.id))
            }
            aria-label={`Remove ${m.full_name}`}
            className="text-slate-400 hover:text-red-600 disabled:opacity-50"
          >
            &times;
          </button>
        </span>
      ))}
      {remaining.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <select
            value={selected}
            disabled={pending}
            onChange={(e) => setSelected(e.target.value)}
            className="text-xs border border-slate-300 rounded-md px-1.5 py-1 bg-white disabled:opacity-50"
          >
            <option value="">+ Add manager</option>
            {remaining.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
          {selected && (
            <button
              type="button"
              disabled={pending}
              onClick={handleAdd}
              className="text-xs font-medium text-[var(--accent)] disabled:opacity-50"
            >
              Add
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export function DeleteDepartmentButton({
  departmentId,
  departmentName,
}: {
  departmentId: string;
  departmentName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (
          confirm(
            `Delete "${departmentName}"? Existing requests that already used this department keep showing it as-is. It will disappear from the dropdown for new requests. This can't be undone from here.`
          )
        ) {
          startTransition(() => deleteDepartment(departmentId));
        }
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  );
}
