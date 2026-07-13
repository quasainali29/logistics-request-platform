"use client";

import { useState, useRef } from "react";
import { createRequest } from "../actions";
import { MAINTENANCE_TYPES, type Category } from "@/lib/types";
import { uploadAttachment, uploadAttachments } from "@/lib/uploadAttachment";

interface DeliveryItemRow {
  key: number;
}

let rowKeyCounter = 0;
function nextKey() {
  rowKeyCounter += 1;
  return rowKeyCounter;
}

function isNextRedirectError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export default function RequestForm() {
  const [category, setCategory] = useState<Category | "">("");
  const [laborRows, setLaborRows] = useState([{ type: "labor", qty: 1 }]);
  const [procRows, setProcRows] = useState([{ desc: "", qty: 1, cost: "" }]);
  const [deliveryItemRows, setDeliveryItemRows] = useState<DeliveryItemRow[]>([
    { key: nextKey() },
  ]);
  const [photoError, setPhotoError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);
    try {
      const formEl = e.currentTarget;
      const raw = new FormData(formEl);

      // Attachments are uploaded directly to Supabase Storage from the
      // browser first; only the resulting URLs (small strings) go to the
      // server action. This avoids Vercel's Server Action / Serverless
      // Function request-body size limits, which real photo/PDF uploads
      // would otherwise blow past.
      const out = new FormData();
      for (const [key, value] of raw.entries()) {
        if (value instanceof File) continue;
        out.append(key, value);
      }

      if (category === "maintenance") {
        const photoFiles = (raw.getAll("maintenance_photos") as File[])
          .filter((f) => f && f.size > 0)
          .slice(0, 6);
        const photos = await uploadAttachments(photoFiles, "maintenance/pending");
        out.append("maintenance_photos_json", JSON.stringify(photos));

        const permitFile = raw.get("maintenance_work_permit") as File | null;
        const permit = await uploadAttachment(permitFile, "maintenance/pending");
        out.append("maintenance_work_permit_json", JSON.stringify(permit ? [permit] : []));
      }

      if (category === "delivery") {
        const permitFile = raw.get("delivery_permit") as File | null;
        const permit = await uploadAttachment(permitFile, "delivery/pending");
        out.append("delivery_permit_json", JSON.stringify(permit ? [permit] : []));

        const imageFiles = raw.getAll("delivery_item_image[]") as File[];
        const images = await Promise.all(
          imageFiles.map((f) => uploadAttachment(f, "delivery/pending/items"))
        );
        out.append(
          "delivery_item_image_urls_json",
          JSON.stringify(images.map((r) => r?.url ?? null))
        );
      }

      await createRequest(out);
      // createRequest redirects on success; if it returns normally we're
      // still on this page, so drop the submitting state.
      setSubmitting(false);
    } catch (err) {
      if (isNextRedirectError(err)) throw err;
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {submitError && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {submitError}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Request details</h2>

        <Field label="Title" required>
          <input name="title" required className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" required>
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
          <Field label="Project" required>
            <input
              name="project"
              required
              placeholder="e.g. Downtown Warehouse Expansion"
              className={inputClass}
            />
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date required">
            <input type="date" name="date_required" className={inputClass} />
          </Field>

          <Field label="Conclude by">
            <input type="date" name="conclude_date" className={inputClass} />
          </Field>
        </div>

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
          <Field label="Delivery location" required>
            <input name="delivery_location" required className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Requested date">
              <input type="date" name="delivery_requested_date" className={inputClass} />
            </Field>
            <Field label="Requested time">
              <input type="time" name="delivery_requested_time" className={inputClass} />
            </Field>
          </div>
          <Field label="Delivery permit (optional)">
            <input
              type="file"
              name="delivery_permit"
              accept="image/*,.pdf"
              className={fileInputClass}
            />
          </Field>

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Items needed</p>
            <div className="space-y-3">
              {deliveryItemRows.map((row, i) => (
                <div
                  key={row.key}
                  className="border border-slate-200 rounded-lg p-3 grid sm:grid-cols-5 gap-2 items-start"
                >
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Item no.</label>
                    <div className="text-sm text-slate-500 px-1 py-2">{i + 1}</div>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Item name</label>
                    <input name="delivery_item_name[]" className={inputClass} />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Required qty</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      name="delivery_item_qty[]"
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Image</label>
                    <input
                      type="file"
                      name="delivery_item_image[]"
                      accept="image/*"
                      className={fileInputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">
                      Current location
                    </label>
                    <input name="delivery_item_location[]" className={inputClass} />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDeliveryItemRows([...deliveryItemRows, { key: nextKey() }])}
              className="text-sm text-[var(--accent)] font-medium mt-2"
            >
              + Add item
            </button>
          </div>
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
          <Field label="Location / area" required>
            <input name="location_area" required className={inputClass} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Type of maintenance" required>
              <select name="maintenance_type" required className={inputClass} defaultValue="">
                <option value="">Select...</option>
                {MAINTENANCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Urgency">
              <select name="urgency" defaultValue="medium" className={inputClass}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Scheduled date">
              <input type="date" name="maintenance_date" className={inputClass} />
            </Field>
            <Field label="Scheduled time">
              <input type="time" name="maintenance_time" className={inputClass} />
            </Field>
          </div>

          <Field label="Photos (up to 6)">
            <input
              type="file"
              name="maintenance_photos"
              accept="image/*"
              multiple
              className={fileInputClass}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 6) {
                  setPhotoError("You can attach up to 6 photos — please reselect.");
                  e.target.value = "";
                } else {
                  setPhotoError("");
                }
              }}
            />
            {photoError && <p className="text-xs text-red-600 mt-1">{photoError}</p>}
          </Field>

          <Field label="Work permit (optional)">
            <input
              type="file"
              name="maintenance_work_permit"
              accept="image/*,.pdf"
              className={fileInputClass}
            />
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
        disabled={submitting}
        className="bg-[var(--accent)] text-white rounded-md px-5 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

const fileInputClass =
  "w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200";

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
