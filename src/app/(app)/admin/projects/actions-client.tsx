"use client";

import { useTransition } from "react";
import { setProjectStatus, deleteProject } from "./actions";

export function ProjectStatusSelect({
  projectId,
  status,
}: {
  projectId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={pending}
      onChange={(e) => startTransition(() => setProjectStatus(projectId, e.target.value))}
      className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white disabled:opacity-50"
    >
      <option value="active">Active</option>
      <option value="on_hold">On hold</option>
      <option value="completed">Completed</option>
    </select>
  );
}

export function DeleteProjectButton({ projectName, projectId }: { projectName: string; projectId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (
          confirm(
            `Delete "${projectName}"? Existing requests linked to it stay as they are, but will show as "Unavailable Project" instead of the real name. It will also disappear from the dropdown for new requests. This can't be undone from here.`
          )
        ) {
          startTransition(() => deleteProject(projectId));
        }
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  );
}
