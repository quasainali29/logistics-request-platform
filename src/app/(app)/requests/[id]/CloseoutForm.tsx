"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { closeRequestWithDocuments } from "../actions";

interface LaborLine {
  personnel_type: string;
  quantity: number;
  cost_per_labor: number;
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
    laborLines && laborLines.length > 0
      ? laborLines
      : [{ personnel_type: "", quantity: 1, cost_per_labor: 0 }]
  );

  const grandTotal = rows.reduce(
    (sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.cost_per_labor) || 0),
    0
  );

  function updateRow(i: number, patch: Partial<LaborLine>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { personnel_type: "", quantity: 1, cost_per_labor: 0 }]);
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
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
        <h2 className="text-sm font-semibold text-slate-900">
          Closeout documents required
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Attach the required documentation below, then mark this request as
          closed.
        </p>
      </div>

      {category === "delivery" && (
        <>
          <Field
            label="Delivery note"
            action={
              <a
                href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/request-attachments/templates/delivery-note-template.xlsx`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--accent)] underline whitespace-nowrap normal-case"
              >
                Download sample template
              </a>
            }
          >
            <input type="file" name="delivery_note" required className="text-sm" />
          </Field>
          <Field label="Delivery location">
            <input
              type="text"
              name="delivery_location"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </>
      )}

      {category === "labor" && (
        <>
          <Field label="Labor sheet">
            <input type="file" name="labor_sheet" required className="text-sm" />
          </Field>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
              Cost breakdown
            </p>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Type of Labor</th>
                    <th className="text-left px-3 py-2 font-medium">Quantity</th>
                    <th className="text-left px-3 py-2 font-medium">Cost/Labor</th>
                    <th className="text-left px-3 py-2 font-medium">Total value</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <input
                          name="cost_type[]"
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
                          name="cost_qty[]"
                          value={r.quantity}
                          onChange={(e) =>
                            updateRow(i, { quantity: parseFloat(e.target.value) || 0 })
                          }
                          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          name="cost_rate[]"
                          value={r.cost_per_labor}
                          onChange={(e) =>
                            updateRow(i, { cost_per_labor: parseFloat(e.target.value) || 0 })
                          }
                          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {((Number(r.quantity) || 0) * (Number(r.cost_per_labor) || 0)).toFixed(2)}
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
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">
                      Grand total
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {grandTotal.toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
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
        </>
      )}

      {category === "maintenance" && (
        <>
          <Field label="Signed maintenance form">
            <input type="file" name="maintenance_form" required className="text-sm" />
          </Field>
          <Field label="Photos of the maintenance">
            <input type="file" name="maintenance_photos" multiple required className="text-sm" />
          </Field>
        </>
      )}

      {category === "procurement" && (
        <>
          <Field label="Invoice">
            <input type="file" name="invoice" required className="text-sm" />
          </Field>
          <Field label="Photos of items procured">
            <input type="file" name="procurement_photos" multiple required className="text-sm" />
          </Field>
          <Field label="Total procurement value">
            <input
              type="number"
              step="0.01"
              min={0}
              name="total_value"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Delivery location">
            <input
              type="text"
              name="delivery_location"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </>
      )}

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

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <label className="block text-xs font-semibold text-slate-500 uppercase">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}
