"use client";

import {
  useState,
  useRef,
  useEffect,
  useContext,
  createContext,
  isValidElement,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createRequest, updateRequest, managerEditRequest } from "../actions";
import { MAINTENANCE_TYPES, PURCHASING_CATEGORIES, NATURE_OF_WORK_OPTIONS, LABOR_TYPES, type Category, type Project, type Department } from "@/lib/types";
import { uploadAttachment, uploadAttachments } from "@/lib/uploadAttachment";

type Attachment = { name: string; url: string };

// -- Describe-and-fill (auto-fill) types --------------------------------
// Shape returned by POST /api/requests/auto-fill. Every field is optional
// on purpose: the server only fills in what it's confident about, and the
// requester reviews/edits everything before submitting -- this never
// submits on its own.
interface AutoFillItem {
  item_name?: string;
  item_description?: string;
  required_quantity?: number | null;
  quantity?: number | null;
  current_location?: string | null;
  purchasing_link?: string | null;
}

interface AutoFillResult {
  category: "delivery" | "labor" | "maintenance" | "procurement" | null;
  title: string | null;
  priority: "low" | "medium" | "high" | "urgent" | null;
  project_id: string | null;
  department: string | null;
  date_required: string | null;
  conclude_date: string | null;
  description: string | null;
  special_instructions: string | null;
  delivery: {
    delivery_location: string | null;
    delivery_requested_date: string | null;
    delivery_requested_time: string | null;
    items: AutoFillItem[];
  } | null;
  maintenance: {
    location_area: string | null;
    maintenance_type: string | null;
    urgency: "low" | "medium" | "high" | "urgent" | null;
    maintenance_date: string | null;
    maintenance_time: string | null;
  } | null;
  procurement: {
    purchasing_category: string | null;
    purchasing_category_other: string | null;
    vendor: string | null;
    procurement_needed_by: string | null;
    items: AutoFillItem[];
  } | null;
  labor: {
    labor_date_from: string | null;
    labor_date_to: string | null;
    lines: { personnel_type: string; nature_of_work?: string | null; quantity?: number | null }[];
  } | null;
}

// Tracks which field names were just populated by auto-fill, so Field()
// can render an "AI-filled" badge -- cleared per-field the moment the
// requester edits that field (see handleFieldTouched).
const HighlightContext = createContext<Set<string>>(new Set());

function fieldNameOf(children: ReactNode): string | undefined {
  const nodes = Array.isArray(children) ? children : [children];
  for (const node of nodes) {
    if (isValidElement(node)) {
      const name = (node.props as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  return undefined;
}

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
  // Legacy free-text value, or the one-off "Other" tag -- only meaningful
  // when project_id is null.
  project: string;
  project_id?: string | null;
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
  mode?: "create" | "edit" | "manager-edit";
  requestId?: string;
  category?: Category;
  initial?: RequestFormInitialData;
  // Active projects for the dropdown.
  projects?: Project[];
  // The request's currently-linked project, even if it's been soft-deleted
  // -- so editing an old request doesn't silently drop a since-removed
  // project. Only relevant in edit mode.
  currentProject?: { id: string; name: string; deleted_at: string | null } | null;
  // Active departments for the dropdown (Admin > Departments).
  departments?: Department[];
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
  projects = [],
  currentProject = null,
  departments = [],
}: RequestFormProps) {
  const isEdit = mode !== "create";
  const isManagerEdit = mode === "manager-edit";
  const [category, setCategory] = useState<Category | "">(initialCategory ?? "");
  const [projectChoice, setProjectChoice] = useState<string>(
    initial?.project_id ? initial.project_id : initial?.project ? "other" : ""
  );
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

  const [describeText, setDescribeText] = useState("");
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillError, setAutoFillError] = useState("");
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  // Holds a category-specific payload when auto-fill switches the category
  // -- the detail section (delivery/maintenance/procurement/labor) doesn't
  // exist in the DOM yet at that point, so applying it waits for the
  // effect below, which runs once the section has mounted.
  const pendingCategoryFillRef = useRef<AutoFillResult | null>(null);

  function setFieldValue(name: string, value: string | null | undefined) {
    if (!value) return;
    const el = formRef.current?.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    if (el) el.value = value;
  }

  function applyCategoryFields(data: AutoFillResult) {
    const newHighlights: string[] = [];
    if (data.category === "delivery" && data.delivery) {
      const d = data.delivery;
      setFieldValue("delivery_location", d.delivery_location);
      setFieldValue("delivery_requested_date", d.delivery_requested_date);
      setFieldValue("delivery_requested_time", d.delivery_requested_time);
      if (d.delivery_location) newHighlights.push("delivery_location");
      if (d.delivery_requested_date) newHighlights.push("delivery_requested_date");
      if (d.delivery_requested_time) newHighlights.push("delivery_requested_time");
      if (d.items?.length) {
        setDeliveryItemRows(
          d.items.map((it) => ({
            key: nextKey(),
            item_name: it.item_name ?? "",
            required_quantity: it.required_quantity ?? undefined,
            current_location: it.current_location ?? undefined,
          }))
        );
        newHighlights.push("delivery_items");
      }
    } else if (data.category === "maintenance" && data.maintenance) {
      const m = data.maintenance;
      setFieldValue("location_area", m.location_area);
      setFieldValue("maintenance_type", m.maintenance_type);
      setFieldValue("urgency", m.urgency);
      setFieldValue("maintenance_date", m.maintenance_date);
      setFieldValue("maintenance_time", m.maintenance_time);
      if (m.location_area) newHighlights.push("location_area");
      if (m.maintenance_type) newHighlights.push("maintenance_type");
      if (m.urgency) newHighlights.push("urgency");
      if (m.maintenance_date) newHighlights.push("maintenance_date");
      if (m.maintenance_time) newHighlights.push("maintenance_time");
    } else if (data.category === "procurement" && data.procurement) {
      const p = data.procurement;
      if (p.purchasing_category) {
        setPurchasingCategory(p.purchasing_category);
        newHighlights.push("purchasing_category");
      }
      setFieldValue("vendor", p.vendor);
      setFieldValue("purchasing_category_other", p.purchasing_category_other);
      setFieldValue("procurement_needed_by", p.procurement_needed_by);
      if (p.vendor) newHighlights.push("vendor");
      if (p.purchasing_category_other) newHighlights.push("purchasing_category_other");
      if (p.procurement_needed_by) newHighlights.push("procurement_needed_by");
      if (p.items?.length) {
        setProcItemRows(
          p.items.map((it) => ({
            key: nextKey(),
            item_description: it.item_description ?? "",
            quantity: it.quantity ?? undefined,
            purchasing_link: it.purchasing_link ?? undefined,
          }))
        );
        newHighlights.push("proc_items");
      }
    } else if (data.category === "labor" && data.labor) {
      const l = data.labor;
      setFieldValue("labor_date_from", l.labor_date_from);
      setFieldValue("labor_date_to", l.labor_date_to);
      if (l.labor_date_from) newHighlights.push("labor_date_from");
      if (l.labor_date_to) newHighlights.push("labor_date_to");
      if (l.lines?.length) {
        setLaborRows(
          l.lines.map((row) => ({
            key: nextKey(),
            personnel_type: row.personnel_type,
            nature_of_work: row.nature_of_work ?? undefined,
            quantity: row.quantity ?? undefined,
          }))
        );
        newHighlights.push("labor_lines");
      }
    }
    if (newHighlights.length) {
      setHighlighted((prev) => new Set([...prev, ...newHighlights]));
    }
  }

  useEffect(() => {
    const pending = pendingCategoryFillRef.current;
    if (pending && category === pending.category) {
      pendingCategoryFillRef.current = null;
      applyCategoryFields(pending);
    }
    // applyCategoryFields is stable enough for this purpose -- it only
    // reads refs/setters, not values that would need to retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  function applyCommonFields(data: AutoFillResult) {
    const newHighlights: string[] = [];
    setFieldValue("title", data.title);
    if (data.title) newHighlights.push("title");
    setFieldValue("date_required", data.date_required);
    if (data.date_required) newHighlights.push("date_required");
    setFieldValue("conclude_date", data.conclude_date);
    if (data.conclude_date) newHighlights.push("conclude_date");
    setFieldValue("description", data.description);
    if (data.description) newHighlights.push("description");
    setFieldValue("special_instructions", data.special_instructions);
    if (data.special_instructions) newHighlights.push("special_instructions");
    if (data.priority) {
      setFieldValue("priority", data.priority);
      newHighlights.push("priority");
    }
    if (data.department) {
      setFieldValue("department", data.department);
      newHighlights.push("department");
    }
    if (newHighlights.length) {
      setHighlighted((prev) => new Set([...prev, ...newHighlights]));
    }
  }

  async function handleAutoFill() {
    if (!describeText.trim()) {
      setAutoFillError("Type a description first.");
      return;
    }
    setAutoFilling(true);
    setAutoFillError("");
    try {
      const res = await fetch("/api/requests/auto-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: describeText }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAutoFillError(json.error || "Couldn't auto-fill that. Try rephrasing.");
        return;
      }
      const data = json.result as AutoFillResult;
      applyCommonFields(data);
      if (data.project_id) {
        setProjectChoice(data.project_id);
        setHighlighted((prev) => new Set(prev).add("project_id"));
      }
      if (data.category) {
        setHighlighted((prev) => new Set(prev).add("category"));
        if (category === data.category) {
          applyCategoryFields(data);
        } else {
          pendingCategoryFillRef.current = data;
          setCategory(data.category);
        }
      }
    } catch {
      setAutoFillError("Couldn't reach auto-fill. Try again.");
    } finally {
      setAutoFilling(false);
    }
  }

  function handleFieldTouched(e: SyntheticEvent<HTMLFormElement>) {
    const target = e.target as HTMLElement;
    const name = target.getAttribute("name");
    if (!name) return;
    let key = name;
    if (key.startsWith("delivery_item_")) key = "delivery_items";
    else if (key.startsWith("proc_item_")) key = "proc_items";
    else if (key.startsWith("labor_type") || key.startsWith("labor_nature") || key.startsWith("labor_qty"))
      key = "labor_lines";
    setHighlighted((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

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

      if (isManagerEdit && requestId) {
        await managerEditRequest(requestId, out);
      } else if (isEdit && requestId) {
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
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onChange={handleFieldTouched}
      onInput={handleFieldTouched}
      className="space-y-8 max-w-2xl"
    >
      <HighlightContext.Provider value={highlighted}>
      {!isEdit && (
        <section className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-6 space-y-3">
          <p className="text-sm font-semibold text-slate-900">Describe your request</p>
          <textarea
            rows={3}
            value={describeText}
            onChange={(e) => setDescribeText(e.target.value)}
            placeholder="e.g. Need someone to deliver 2 folding tables and 10 chairs from the warehouse to Inflata Park by Friday, it's for a birthday event so kind of urgent"
            className={inputClass}
          />
          {autoFillError && <p className="text-xs text-red-600">{autoFillError}</p>}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={autoFilling}
              className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {autoFilling ? "Filling…" : "Auto-fill form"}
            </button>
            <p className="text-xs text-slate-500">Fields it fills are marked below — review before submitting.</p>
          </div>
        </section>
      )}
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
            {/* SLA windows shown directly in the option labels so they're
                visible both closed and open, with no extra UI needed. */}
            <select name="priority" defaultValue={initial?.priority ?? "medium"} className={inputClass}>
              <option value="low">Low (1 week)</option>
              <option value="medium">Medium (3-4 days)</option>
              <option value="high">High (24-48 hours)</option>
              <option value="urgent">Urgent (within 24 hours)</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Project" required>
            <select
              name="project_id"
              required
              value={projectChoice}
              onChange={(e) => setProjectChoice(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Select...
              </option>
              {currentProject?.deleted_at && !projects.some((p) => p.id === currentProject.id) && (
                <option value={currentProject.id}>{currentProject.name} (unavailable)</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
            {projectChoice === "other" && (
              <input
                name="project_other"
                required
                placeholder="Enter the project name"
                defaultValue={initial?.project_id ? "" : initial?.project ?? ""}
                className={`${inputClass} mt-2`}
              />
            )}
          </Field>

          <Field label="Department">
            <select name="department" className={inputClass} defaultValue={initial?.department ?? ""}>
              <option value="">Select...</option>
              {/* Covers a department that's since been removed from Admin >
                  Departments (or an old free-text value from before that
                  list existed) so the field doesn't silently go blank. */}
              {initial?.department &&
                !departments.some((d) => d.name === initial.department) && (
                  <option value={initial.department}>{initial.department} (unavailable)</option>
                )}
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Paired date inputs stack to a single column on phones -- native
            date pickers render wider than a select and get cramped in a
            fixed 2-column grid at narrow widths. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              Items needed
              {highlighted.has("delivery_items") && (
                <span className="text-[10px] font-normal text-[var(--accent)] bg-indigo-100 rounded px-1.5 py-0.5">
                  AI-filled — check
                </span>
              )}
            </p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              Personnel needed
              {highlighted.has("labor_lines") && (
                <span className="text-[10px] font-normal text-[var(--accent)] bg-indigo-100 rounded px-1.5 py-0.5">
                  AI-filled — check
                </span>
              )}
            </p>
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
              {/* SLA windows shown directly in the option labels, same
                  approach and same 4 tiers as Priority above. */}
              <select name="urgency" defaultValue={initial?.urgency ?? "medium"} className={inputClass}>
                <option value="low">Low (1 week)</option>
                <option value="medium">Medium (3-4 days)</option>
                <option value="high">High (24-48 hours)</option>
                <option value="urgent">Urgent (within 24 hours)</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              Line items
              {highlighted.has("proc_items") && (
                <span className="text-[10px] font-normal text-[var(--accent)] bg-indigo-100 rounded px-1.5 py-0.5">
                  AI-filled — check
                </span>
              )}
            </p>
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

      {isManagerEdit && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Reason for change</h2>
          <p className="text-xs text-slate-500 -mt-2">
            Shown to the requestor along with a summary of what changed.
          </p>
          <Field label="Reason" required>
            <textarea
              name="edit_reason"
              required
              rows={3}
              className={inputClass}
              placeholder="e.g. Contractor unavailable until the 14th, pushing the due date back a week."
            />
          </Field>
        </section>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-[var(--accent)] text-white rounded-md px-5 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting
          ? "Submitting…"
          : isManagerEdit
          ? "Save changes"
          : isEdit
          ? "Save & Resubmit"
          : "Submit request"}
      </button>
      </HighlightContext.Provider>
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
  children: ReactNode;
  required?: boolean;
}) {
  const highlighted = useContext(HighlightContext);
  const name = fieldNameOf(children);
  const isHighlighted = !!name && highlighted.has(name);
  return (
    <div
      className={
        isHighlighted ? "rounded-md ring-1 ring-[var(--accent)] bg-indigo-50/50 p-2 -m-2" : undefined
      }
    >
      <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {isHighlighted && (
          <span className="text-[10px] font-normal text-[var(--accent)] bg-indigo-100 rounded px-1.5 py-0.5">
            AI-filled — check
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
