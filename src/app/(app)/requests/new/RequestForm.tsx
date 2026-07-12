"use client";

import { useState } from "react";
import { createRequest } from "../actions";
import type { Category } from "@/lib/types";

interface Project {
  id: string;
  name: string;
}

export default function RequestForm({ projects }: { projects: Project[] }) {
  const [category, setCategory] = useState<Category | "">("");
  const [laborRows, setLaborRows] = useState([{ type: "labor", qty: 1 }]);
  const [procRows, setProcRows] = useState([{ desc: "", qty: 1, cost: "" }]);

  return (
    <form action={createRequest} className="space-y-8 max-w-2xl">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Request details</h2>

        <Field label="Title">
          <input name="title" required className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <select
              name="category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className={inputClass}
            >
              <option value="">Select...</option>
              <option value="delivery">Delivery</option>
              <option value="labor">Labor</option>
              <option value="maintenance">Maintenance</option>
              <option value="procurement">Procurement</option>
            </select>
          </Field>

          <Field label="Priority">
            <select name="priority" defaultValue="medium" className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Project (optional)">
            <select name="project_id" className={inputClass} defaultValue="">
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Department">
            <select name="department" className={inputClass} defaultValue="">
              <option value="">Select...</option>
              <option value="logistics">Logistics</option>
              <option value="operations">Operations</option>
              <option value="it">IT</option>
              <option value="marketing">Marketing</option>
              <option value="production">Production</option>
            </select>
          </Field>
        </div>

        <Field label="Date required">
          <input type="date" name="date_required" className={inputClass} />
        </Field>

        <Field label="Description">
          <textarea name="description" rows={3} className={inputClass} />
        </Field>

        <Field label="Special instructions">
          <textarea name="special_instructions" rows={2} className={inputClass} />
        </Field>
      </section>

      {category === "delivery" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Delivery details</h2>
          <Field label="Delivery location">
            <input name="delivery_location" required className={inputClass} />
          </Field>
          <Field label="Requested date">
            <input type="date" name="delivery_requested_date" className={inputClass} />
          </Field>
        </section>
      )}

      {category === "labor" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Labor details</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date from">
              <input type="date" name="labor_date_from" className={inputClass} />
            </Field>
            <Field label="Date to">
              <input type="date" name="labor_date_to" className={inputClass} />
            </Field>
          </div>
          <Field label="Nature of work">
            <select name="nature_of_work" className={inputClass} defaultValue="">
              <option value="">Select...</option>
              <option value="loading_unloading">Loading / Unloading</option>
              <option value="setup_installation">Setup / Installation</option>
              <option value="removal_dismantling">Removal / Dismantling</option>
            </select>
          </Field>

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Personnel needed</p>
            {laborRows.map((row, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <select
                  name="labor_type[]"
                  defaultValue={row.type}
                  className={inputClass}
                >
                  <option value="labor">Labor</option>
                  <option value="welder">Welder</option>
                  <option value="carpenter">Carpenter</option>
                  <option value="rigger">Rigger</option>
                  <option value="electrician">Electrician</option>
                </select>
                <input
                  type="number"
                  name="labor_qty[]"
                  min={1}
                  defaultValue={row.qty}
                  className={`${inputClass} w-24`}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLaborRows([...laborRows, { type: "labor", qty: 1 }])}
              className="text-sm text-[var(--accent)] font-medium"
            >
              + Add role
            </button>
          </div>
        </section>
      )}

      {category === "maintenance" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Maintenance details</h2>
          <Field label="Location / area">
            <input name="location_area" required className={inputClass} />
          </Field>
          <Field label="Issue category">
            <input name="issue_category" className={inputClass} />
          </Field>
          <Field label="Urgency">
            <select name="urgency" defaultValue="medium" className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
        </section>
      )}

      {category === "procurement" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Procurement details</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Purchasing category">
              <select name="purchasing_category" className={inputClass} defaultValue="">
                <option value="">Select...</option>
                <option value="tools">Tools</option>
                <option value="it_equipment">IT Equipment</option>
                <option value="av_equipment">AV Equipment</option>
                <option value="electrical_equipment">Electrical Equipment</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Vendor (optional)">
              <input name="vendor" className={inputClass} />
            </Field>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Line items</p>
            {procRows.map((row, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  name="proc_desc[]"
                  placeholder="Description"
                  className={`${inputClass} flex-1`}
                />
                <input
                  type="number"
                  name="proc_qty[]"
                  min={1}
                  defaultValue={row.qty}
                  className={`${inputClass} w-20`}
                  placeholder="Qty"
                />
                <input
                  type="number"
                  step="0.01"
                  name="proc_cost[]"
                  className={`${inputClass} w-28`}
                  placeholder="Unit cost"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setProcRows([...procRows, { desc: "", qty: 1, cost: "" }])
              }
              className="text-sm text-[var(--accent)] font-medium"
            >
              + Add line item
            </button>
          </div>
        </section>
      )}

      <button
        type="submit"
        className="bg-[var(--accent)] text-white rounded-md px-5 py-2.5 text-sm font-medium hover:opacity-90 transition"
      >
        Submit request
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
