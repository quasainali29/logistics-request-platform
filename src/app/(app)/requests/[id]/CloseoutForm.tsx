"use client";

import { useState, useTransition, type FormEvent } from "react";
import { closeRequestWithDocuments } from "../actions";
import { COST_CATEGORIES, type CostCategory } from "@/lib/types";

interface LaborLine {
  personnel_type: string;
  quantity: number;
}

interface CostLine {
  cost_category: CostCategory;
  description: string;
  amount: number;
}

export function CloseoutForm({
  requestId,
  category,
  laborLines,
}: {
  requestId: string;
  category: string;
  laborLines?: LaborLine[];
}) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<LaborLine[]>(
    laborLines && laborLines.length > 0 ? laborLines : [{ personnel_type: "", quantity: 1 }]
  );
  const [costLines, setCostLines] = useState<CostLine[]>([
    { cost_category: "other", description: "", amount: 0 },
  ]);

  const costGrandTotal = costLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  function updateRow(i: number, patch: Partial<LaborLine>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { personnel_type: "", quantity: 1 }]);
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function updateCostLine(i: number, patch: Partial<CostLine>) {
    setCostLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addCostLine() {
    setCostLines((prev) => [...prev, { cost_category: "other", description: "", amount: 0 }]);
  }

  function removeCostLine(i: number) {
    setCostLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => {
      closeRequestWithDocuments(requestId, formData);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Closeout</h2>
        <p className="text-xs text-slate-500 mt-1">
          Review the completion proof above, confirm the final cost, then
          close this request.
        </p>
      </div>

      {/* Delivery, maintenance and procurement no longer collect any
          documents here -- the technician's photos and signature (shown in
          Job completion, above) are the proof of completion now. Labor
          keeps a lightweight personnel-deployed confirmation, since that
          reflects who actually showed up rather than anything captured by
          the technician flow. */}
      {category === "labor" && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
            Personnel deployed
          </p>
          <p className="text-xs text-slate-500 mb-2">
            Pre-filled from the original request -- adjust if what was
            actually sent differs.
          </p>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Type of Labor</th>
                  <th className="text-left px-3 py-2 font-medium">Quantity</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input
                        name="personnel_type[]"
                        value={r.personnel_type}
                        onChange={(e) => updateRow(i, { personnel_type: e.target.value })}
                        required
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        name="personnel_qty[]"
                        value={r.quantity}
                        onChange={(e) =>
                          updateRow(i, { quantity: parseFloat(e.target.value) || 0 })
                        }
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="mt-2 text-xs text-[var(--accent)] hover:underline"
          >
            + Add row
          </button>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
          Cost incurred
        </p>
        <p className="text-xs text-slate-500 mb-2">
          Log every cost that went into completing this request. This feeds
          the Cost report and can be adjusted later by a manager.
        </p>
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {costLines.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <select
                      name="cost_line_category[]"
                      value={l.cost_category}
                      onChange={(e) =>
                        updateCostLine(i, { cost_category: e.target.value as CostCategory })
                      }
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {COST_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      name="cost_line_description[]"
                      value={l.description}
                      onChange={(e) => updateCostLine(i, { description: e.target.value })}
                      placeholder="Optional"
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      name="cost_line_amount[]"
                      value={l.amount}
                      onChange={(e) =>
                        updateCostLine(i, { amount: parseFloat(e.target.value) || 0 })
                      }
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeCostLine(i)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">
                  Total cost
                </td>
                <td className="px-3 py-2 font-semibold text-slate-900">
                  {costGrandTotal.toFixed(2)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button
          type="button"
          onClick={addCostLine}
          className="mt-2 text-xs text-[var(--accent)] hover:underline"
        >
          + Add cost line
        </button>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition disabled:opacity-50"
      >
        {pending ? "Closing…" : "Mark Closed"}
      </button>
    </form>
  );
}

