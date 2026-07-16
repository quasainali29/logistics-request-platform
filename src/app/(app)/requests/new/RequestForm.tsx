"use client";

import { useState, useRef } from "react";
import { createRequest, updateRequest } from "../actions";
import { MAINTENANCE_TYPES, PURCHASING_CATEGORIES, NATURE_OF_WORK_OPTIONS, LABOR_TYPES, type Category } from "@/lib/types";
import { uploadAttachment, uploadAttachments } from "@/lib/uploadAttachment";

type Attachment = { name: string; url: string };

interface DeliveryItemRow {
  key: number;
  item_name?: string;
  required_quantity?: number;
  image_url?: string | null;
  current_location?: string | null;
}

interface ProcItemRow {
  key: number;
  item_description?: string;
  quantity?: number;
  image_url?: string | null;
  purchasing_link?: string | null;
}

interface LaborRow {
  key: number;
  personnel_type?: string;
  quantity?: number;
  nature_of_work?: string | null;
}

export interface RequestFormInitialData {
  title: string;
  priority: string;
  project: string;
  department: string | null;
  date_required: string | null;
  conclude_date: string | null;
  description: string | null;
  special_instructions: string | null;
  location_area?: string | null;
  maintenance_type?: string | null;
  urgency?: string | null;
  maintenance_date?: string | null;
  maintenance_time?: string | null;
  maintenance_photos?: Attachment[];
  maintenance_work_permit?: Attachment[];
  delivery_location?: string | null;
  delivery_requested_date?: string | null;
  delivery_requested_time?: string | null;
  delivery_permit?: Attachment[];
  delivery_items?: {
    item_name: string;
    required_quantity: number;
    image_url: string | null;
    current_location: string | null;
  }[];
  purchasing_category?: string | null;
  purchasing_category_other?: string | null;
  vendor?: string | null;
  procurement_needed_by?: string | null;
  procurement_items?: {
    item_description: string;
    quantity: number;
    image_url: string | null;
    purchasing_link: string | null;
  }[];
  labor_date_from?: string | null;
  labor_date_to?: string | null;
  labor_lines?: { personnel_type: string; quantity: number; nature_of_work?: string | null }[];
}

interface RequestFormProps {
  mode?: "create" | "edit";
  requestId?: string;
  category?: Category;
  initial?: RequestFormInitialData;
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

export default function RequestForm({
  mode = "create",
  requestId,
  category: initialCategory,
  initial,
}: RequestFormProps) {
  const isEdit = mode === "edit";
  const [category, setCategory] = useState<Category | "">(initialCategory ?? "");
  const [laborRows, setLaborRows] = useState<LaborRow[]>(
    initial?.labor_lines?.length
      ? initial.labor_lines.map((l) => ({ key: nextKey(), ...l }))
      : [{ key: nextKey() }]
  );
  const [procItemRows, setProcItemRows] = useState<ProcItemRow[]>(
    initial?.procurement_items?.length
      ? initial.procurement_items.map((p) => ({ key: nextKey(), ...p }))
      : [{ key: nextKey() }]
  );
  const [deliveryItemRows, setDeliveryItemRows] = useState<DeliveryItemRow[]>(
    initial?.delivery_items?.length
      ? initial.delivery_items.map((d) => ({ key: nextKey(), ...d }))
      : [{ key: nextKey() }]
  );
  const [purchasingCategory, setPurchasingCategory] = useState(initial?.purchasing_category ?? "");
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

        // Edit mode: if the requester doesn't pick new files, the server
        // action falls back to whatever was already attached rather than
        // wiping them out.
        if (isEdit) {
          out.append(
            "maintenance_photos_existing_json",
            JSON.stringify(initial?.maintenance_photos ?? [])
          );
          out.append(
            "maintenance_work_permit_existing_json",
            JSON.stringify(initial?.maintenance_work_permit ?? [])
          );
        }
      }

      if (category === "delivery") {
        const permitFile = raw.get("delivery_permit") as File | null;
        const permit = await uploadAttachment(permitFile, "delivery/pending");
        out.append("delivery_permit_json", JSON.stringify(permit ? [permit] : []));

        if (isEdit) {
          out.append(
            "delivery_permit_existing_json",
            JSON.stringify(initial?.delivery_permit ?? [])
          );
        }

        const imageFiles = raw.getAll("delivery_item_image[]") as File[];
        const images = await Promise.all(
          imageFiles.map((f) => uploadAttachment(f, "delivery/pending/items"))
        );
        out.append(
          "delivery_item_image_urls_json",
          JSON.stringify(images.map((r) => r?.url ?? null))
        );
      }

      if (category === "procurement") {
        const imageFiles = raw.getAll("proc_item_image[]") as File[];
        const images = await Promise.all(
          imageFiles.map((f) => uploadAttachment(f, "procurement/pending/items"))
        );
        out.append(
          "proc_item_image_urls_json",
          JSON.stringify(images.map((r) => r?.url ?? null))
        );
      }

      if (isEdit && requestId) {
        await updateRequest(requestId, out);
      } else {
        await createRequest(out);
      }
      // Both actions redirect on success; if we get here we're still on
      // this page, so drop the submitting state.
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
          <input name="title" required defaultValue={initial?.title ?? ""} className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" required>
            <select
              name="category"
              required
              disabled={isEdit}
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className={`${inputClass} ${isEdit ? "bg-slate-100 text-slate-500" : ""}`}
            >
              <option value="">Select...</option>
              <option value="delivery">Delivery</option>
              <option value="labor">Labor</option>
              <option value="maintenance">Maintenance</option>
              <option value="procurement">Procurement</option>
            </select>
            {isEdit && (
              <p className="text-xs text-slate-500 mt-1">Category can&rsquo;t be changed.</p>
            )}
          </Field>

          <Field label="Priority">
            <select name="priority" defaultValue={initial?.priority ?? "medium"} className={inputClass}>
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
              defaultValue={initial?.project ?? ""}
              className={inputClass}
            />
          </Field>

          <Field label="Department">
            <select name="department" className={inputClass} defaultValue={initial?.department ?? ""}>
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
            <input
              type="date"
              name="date_required"
              defaultValue={initial?.date_required ?? ""}
              className={inputClass}
            />
          </Field>

          <Field label="Conclude by">
            <input
              type="date"
              name="conclude_date"
              defaultValue={initial?.conclude_date ?? ""}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            name="description"
            rows={3}
            defaultValue={initial?.description ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Special instructions">
          <textarea
            name="special_instructions"
            rows={2}
            defaultValue={initial?.special_instructions ?? ""}
            className={inputClass}
          />
        </Field>
      </section>

      {category === "delivery" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Delivery details</h2>
          <Field label="Delivery location" required>
            <input
              name="delivery_location"
              required
              defaultValue={initial?.delivery_location ?? ""}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Requested date">
              <input
                type="date"
                name="delivery_requested_date"
                defaultValue={initial?.delivery_requested_date ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label="Requested time">
              <input
                type="time"
                name="delivery_requested_time"
                defaultValue={initial?.delivery_requested_time ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Delivery permit (optional)">
            {isEdit && initial?.delivery_permit && initial.delivery_permit.length > 0 && (
              <p className="text-xs text-slate-500 mb-1">
                Current: {initial.delivery_permit.map((f) => f.name).join(", ")} — choose a file
                below to replace it.
              </p>
            )}
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
                    <input
                      name="delivery_item_name[]"
                      defaultValue={row.item_name ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Required qty</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      name="delivery_item_qty[]"
                      defaultValue={row.required_quantity ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Image</label>
                    {row.image_url && (
                      <p className="text-xs text-slate-500 mb-1 truncate">Has image — replace below</p>
                    )}
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
                    <input
                      name="delivery_item_location[]"
                      defaultValue={row.current_location ?? ""}
                      className={inputClass}
                    />
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
              <input
                type="date"
                name="labor_date_from"
                defaultValue={initial?.labor_date_from ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label="Date to">
              <input
                type="date"
                name="labor_date_to"
                defaultValue={initial?.labor_date_to ?? ""}
                className={inputClass}
              />
            </Field>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Personnel needed</p>
            <div className="space-y-3">
              {laborRows.map((row, i) => (
                <div
                  key={row.key}
                  className="border border-slate-200 rounded-lg p-3 grid sm:grid-cols-4 gap-2 items-start"
                >
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Item no.</label>
                    <div className="text-sm text-slate-500 px-1 py-2">{i + 1}</div>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">
                      Type of requirement
                    </label>
                    <select
                      name="labor_type[]"
                      defaultValue={row.personnel_type ?? "labor"}
                      className={inputClass}
                    >
                      {LABOR_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Nature of work</label>
                    <select
                      name="labor_nature[]"
                      defaultValue={row.nature_of_work ?? ""}
                      className={inputClass}
                    >
                      <option value="">Select...</option>
                      {NATURE_OF_WORK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Qty</label>
                    <input
                      type="number"
                      name="labor_qty[]"
                      min={1}
                      defaultValue={row.quantity ?? 1}
                      className={inputClass}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLaborRows([...laborRows, { key: nextKey() }])}
              className="text-sm text-[var(--accent)] font-medium mt-2"
            >
              + Add role
            </button>
          </div>
        </section>
      )}

      {category === "maintenance" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Maintenance details</h2>
            <a
              href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/request-attachments/templates/maintenance-request-template.xlsx`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[var(--accent)] underline whitespace-nowrap"
            >
              Download sample template
            </a>
          </div>
          <Field label="Location / area" required>
            <input
              name="location_area"
              required
              defaultValue={initial?.location_area ?? ""}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Type of maintenance" required>
              <select
                name="maintenance_type"
                required
                className={inputClass}
                defaultValue={initial?.maintenance_type ?? ""}
              >
                <option value="">Select...</option>
                {MAINTENANCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Urgency">
              <select name="urgency" defaultValue={initial?.urgency ?? "medium"} className={inputClass}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Scheduled date">
              <input
                type="date"
                name="maintenance_date"
                defaultValue={initial?.maintenance_date ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label="Scheduled time">
              <input
                type="time"
                name="maintenance_time"
                defaultValue={initial?.maintenance_time ?? ""}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Photos (up to 6)">
            {isEdit && initial?.maintenance_photos && initial.maintenance_photos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {initial.maintenance_photos.map((p, i) => (
                  <a
                    key={i}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-14 h-14 rounded-md overflow-hidden border border-slate-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            )}
            {isEdit && (
              <p className="text-xs text-slate-500 mb-1">
                Choosing new photos replaces the current ones above.
              </p>
            )}
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
            {isEdit && initial?.maintenance_work_permit && initial.maintenance_work_permit.length > 0 && (
              <p className="text-xs text-slate-500 mb-1">
                Current:{" "}
                {initial.maintenance_work_permit.map((f, i) => (
                  <a
                    key={i}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] underline"
                  >
                    {f.name}
                  </a>
                ))}{" "}
                — choose a file below to replace it.
              </p>
            )}
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
              <select
                name="purchasing_category"
                className={inputClass}
                value={purchasingCategory}
                onChange={(e) => setPurchasingCategory(e.target.value)}
              >
                <option value="">Select...</option>
                {PURCHASING_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vendor (optional)">
              <input name="vendor" defaultValue={initial?.vendor ?? ""} className={inputClass} />
            </Field>
          </div>

          {purchasingCategory === "other" && (
            <Field label="Please specify">
              <input
                name="purchasing_category_other"
                placeholder="e.g. Office furniture"
                defaultValue={initial?.purchasing_category_other ?? ""}
                className={inputClass}
              />
            </Field>
          )}

          <Field label="Needed by">
            <input
              type="date"
              name="procurement_needed_by"
              defaultValue={initial?.procurement_needed_by ?? ""}
              className={inputClass}
            />
          </Field>

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Line items</p>
            <div className="space-y-3">
              {procItemRows.map((row, i) => (
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
                    <input
                      name="proc_item_name[]"
                      defaultValue={row.item_description ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">Required qty</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      name="proc_item_qty[]"
                      defaultValue={row.quantity ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">
                      Image reference
                    </label>
                    {row.image_url && (
                      <p className="text-xs text-slate-500 mb-1 truncate">Has image — replace below</p>
                    )}
                    <input
                      type="file"
                      name="proc_item_image[]"
                      accept="image/*"
                      className={fileInputClass}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-slate-500 mb-1">
                      Purchasing link
                    </label>
                    <input
                      name="proc_item_link[]"
                      placeholder="https://..."
                      defaultValue={row.purchasing_link ?? ""}
                      className={inputClass}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setProcItemRows([...procItemRows, { key: nextKey() }])}
              className="text-sm text-[var(--accent)] font-medium mt-2"
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
        {submitting ? "Submitting…" : isEdit ? "Save & Resubmit" : "Submit request"}
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
