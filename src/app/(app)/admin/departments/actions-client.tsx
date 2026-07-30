"use client";

import { useTransition } from "react";
import { deleteDepartment } from "./actions";

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
