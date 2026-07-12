"use client";

import { useTransition } from "react";
import { deleteStage, deleteTransition } from "./actions";

export function DeleteStageButton({
  stageId,
  category,
  stageLabel,
}: {
  stageId: string;
  category: string;
  stageLabel: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete the "${stageLabel}" stage? Only works if nothing references it.`)) {
          startTransition(() => deleteStage(stageId, category));
        }
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  );
}

export function DeleteTransitionButton({
  transitionId,
  category,
}: {
  transitionId: string;
  category: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this transition? The button will no longer appear for anyone.")) {
          startTransition(() => deleteTransition(transitionId, category));
        }
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  );
}
