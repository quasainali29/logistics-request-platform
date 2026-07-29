"use client";

import { useState, useTransition, type FormEvent } from "react";
import { addCostLine, deleteCostLine } from "./cost-actions";
import { COST_CATEGORIES, COST_CATEGORY_LABELS, type RequestCostLine } from "@/lib/types";

export function CostBreakdownManager({
  requestId,
  lines,
  canEdit,
}: {
  requestId: string;
  lines: RequestCostLine[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const total = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData();
    formData.set("cost_category", category);
    formData.set("description", description);
    formData.set("amount", amount);
    startTransition(async () => {
      await addCostLine(requestId, formData);
      setDescription("");
      setAmount("");
    });
  }

  function handleDelete(lineId: string) {
    startTransition(async () => {
      await deleteCostLine(lineId, requestId);
    });
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">Cost breakdown</h2>

      {lines.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No cost lines recorded yet.</p>
      ) : (
        <div className="overflow-hidden border border-slate-200 rounded-lg mb-4">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium">Amount</th>
                {canEdit && <th className="px-3 py-2 w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-slate-900">
                    {COST_CATEGORY_LABELS[l.cost_category] ?? l.cost_category}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{l.description ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-900 font-medium">
                    {Number(l.amount).toFixed(2)}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleDelete(l.id)}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={2}
                  className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase"
                >
                  Total
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900">{total.toFixed(2)}</td>
                {canEdit && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
              Amount
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
    </section>
  );
}
