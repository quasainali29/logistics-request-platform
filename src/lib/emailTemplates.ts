import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORY_LABELS, STATUS_LABELS, type Category } from "@/lib/types";

// Small, dependency-free escaper — request titles/descriptions/instructions
// are free-text from the submission form and get interpolated straight into
// email HTML, so anything a user typed (including "<" or "&") must be
// escaped before it lands in the template.
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatEmailDate(
  dateStr?: string | null,
  timeStr?: string | null
): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  const formatted = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return timeStr ? `${formatted}, ${timeStr}` : formatted;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: "#f1f5f9", text: "#475569", label: "Low" },
  medium: { bg: "#dbeafe", text: "#1d4ed8", label: "Medium" },
  high: { bg: "#fef3c7", text: "#92400e", label: "High" },
  urgent: { bg: "#fee2e2", text: "#991b1b", label: "Urgent" },
};

export interface EmailDetailRow {
  label: string;
  value: string;
}

export interface RequestEmailInput {
  requestNumber: string;
  title: string;
  category: string;
  priority?: string | null;
  status?: string | null;
  requestorName?: string | null;
  project?: string | null;
  department?: string | null;
  dateRequired?: string | null;
  concludeDate?: string | null;
  description?: string | null;
  specialInstructions?: string | null;
  categoryDetails?: EmailDetailRow[];
  headline: string;
  ctaLabel: string;
  ctaUrl: string;
}

function rowHtml(r: EmailDetailRow): string {
  return `<tr><td style="color:#6b7280;padding:5px 0;width:40%;">${r.label}</td><td style="padding:5px 0;color:#111827;">${r.value}</td></tr>`;
}

// Shared "request card" layout used for every request-related notification
// (new request -> manager/requestor, coordinator assignment, status
// changes). Centralizing this in one place means all three notification
// points render identically and only need to be updated once.
export function buildRequestEmailHtml(data: RequestEmailInput): string {
  const priorityStyle = data.priority
    ? PRIORITY_STYLES[data.priority] ?? PRIORITY_STYLES.medium
    : null;
  const categoryLabel = CATEGORY_LABELS[data.category as Category] ?? data.category;
  const statusLabel = data.status ? STATUS_LABELS[data.status] ?? data.status : null;

  const commonRows: EmailDetailRow[] = [];
  if (data.requestorName) {
    commonRows.push({ label: "Submitted by", value: escapeHtml(data.requestorName) });
  }
  if (data.project) {
    commonRows.push({ label: "Project", value: escapeHtml(data.project) });
  }
  if (data.department) {
    commonRows.push({ label: "Department", value: escapeHtml(data.department) });
  }
  const dateRequired = formatEmailDate(data.dateRequired);
  if (dateRequired) commonRows.push({ label: "Date required", value: dateRequired });
  const concludeDate = formatEmailDate(data.concludeDate);
  if (concludeDate) commonRows.push({ label: "Conclude by", value: concludeDate });

  const categoryRows = data.categoryDetails ?? [];
  const divider =
    commonRows.length > 0 && categoryRows.length > 0
      ? `<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:8px;"></td></tr>`
      : "";

  const detailRowsHtml =
    commonRows.map(rowHtml).join("") + divider + categoryRows.map(rowHtml).join("");

  const badges = [
    priorityStyle
      ? `<span style="background:${priorityStyle.bg};color:${priorityStyle.text};font-size:12px;padding:3px 10px;border-radius:6px;margin-right:6px;">${priorityStyle.label} priority</span>`
      : "",
    `<span style="background:#f3f4f6;color:#374151;font-size:12px;padding:3px 10px;border-radius:6px;margin-right:6px;">${categoryLabel}</span>`,
    statusLabel
      ? `<span style="background:#f3f4f6;color:#374151;font-size:12px;padding:3px 10px;border-radius:6px;">${statusLabel}</span>`
      : "",
  ].join("");

  const descriptionBlock = data.description
    ? `<div style="border-top:1px solid #e5e7eb;padding-top:10px;margin-bottom:16px;"><p style="font-size:12px;color:#9ca3af;margin:0 0 4px;">Description</p><p style="font-size:13px;margin:0;color:#111827;">${escapeHtml(
        data.description
      )}</p></div>`
    : "";

  const instructionsBlock = data.specialInstructions
    ? `<div style="border-top:1px solid #e5e7eb;padding-top:10px;margin-bottom:16px;"><p style="font-size:12px;color:#9ca3af;margin:0 0 4px;">Special instructions</p><p style="font-size:13px;margin:0;color:#111827;">${escapeHtml(
        data.specialInstructions
      )}</p></div>`
    : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#eff6ff;padding:16px 20px;border:1px solid #dbeafe;border-bottom:none;border-radius:8px 8px 0 0;">
    <p style="margin:0;font-size:13px;color:#1d4ed8;">${escapeHtml(data.headline)}</p>
    <p style="margin:4px 0 0;font-size:18px;font-weight:bold;color:#1d4ed8;">${escapeHtml(
      data.requestNumber
    )} &mdash; ${escapeHtml(data.title)}</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
    <div style="margin-bottom:16px;">${badges}</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px;">${detailRowsHtml}</table>
    ${descriptionBlock}${instructionsBlock}
    <div style="text-align:center;margin-top:8px;">
      <a href="${data.ctaUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;padding:10px 24px;border-radius:6px;text-decoration:none;">${escapeHtml(
    data.ctaLabel
  )}</a>
    </div>
  </div>
</div>`;
}

// Pulls the handful of category-specific fields worth surfacing in an
// email (not the full detail row — just enough for someone to act without
// opening the app). Best-effort: a missing/failed lookup just means those
// rows are omitted, it never blocks the notification.
export async function fetchCategoryDetails(
  supabase: SupabaseClient,
  category: string,
  requestId: string
): Promise<EmailDetailRow[]> {
  const rows: EmailDetailRow[] = [];

  try {
    if (category === "delivery") {
      const [{ data: details }, { count }] = await Promise.all([
        supabase
          .from("delivery_details")
          .select("delivery_location, requested_date, requested_time")
          .eq("request_id", requestId)
          .maybeSingle(),
        supabase
          .from("delivery_items")
          .select("id", { count: "exact", head: true })
          .eq("request_id", requestId),
      ]);
      if (details?.delivery_location) {
        rows.push({ label: "Delivery location", value: escapeHtml(details.delivery_location) });
      }
      const when = formatEmailDate(details?.requested_date, details?.requested_time);
      if (when) rows.push({ label: "Requested for", value: when });
      if (count) rows.push({ label: "Items", value: `${count} item${count === 1 ? "" : "s"}` });
    } else if (category === "maintenance") {
      const { data: details } = await supabase
        .from("maintenance_details")
        .select("location_area, maintenance_type, urgency, scheduled_date, scheduled_time, photos")
        .eq("request_id", requestId)
        .maybeSingle();
      if (details?.location_area) {
        rows.push({ label: "Location / area", value: escapeHtml(details.location_area) });
      }
      if (details?.maintenance_type) {
        rows.push({ label: "Maintenance type", value: escapeHtml(details.maintenance_type) });
      }
      if (details?.urgency) {
        rows.push({
          label: "Urgency",
          value: details.urgency.charAt(0).toUpperCase() + details.urgency.slice(1),
        });
      }
      const when = formatEmailDate(details?.scheduled_date, details?.scheduled_time);
      if (when) rows.push({ label: "Scheduled for", value: when });
      if (details?.photos?.length) {
        rows.push({ label: "Photos attached", value: `${details.photos.length}` });
      }
    } else if (category === "labor") {
      const { data: lines } = await supabase
        .from("labor_personnel_lines")
        .select("personnel_type, quantity, date_from, date_to, nature_of_work")
        .eq("request_id", requestId);
      if (lines && lines.length > 0) {
        const summary = lines.map((l) => `${l.quantity}× ${l.personnel_type}`).join(", ");
        rows.push({ label: "Personnel", value: escapeHtml(summary) });
        const from = formatEmailDate(lines[0].date_from);
        const to = formatEmailDate(lines[0].date_to);
        const when = from && to ? `${from} to ${to}` : from ?? to;
        if (when) rows.push({ label: "Dates", value: when });
        if (lines[0].nature_of_work) {
          rows.push({ label: "Nature of work", value: escapeHtml(lines[0].nature_of_work) });
        }
      }
    } else if (category === "procurement") {
      const [{ data: details }, { count }] = await Promise.all([
        supabase
          .from("procurement_details")
          .select("purchasing_category, purchasing_category_other, vendor, needed_by_date")
          .eq("request_id", requestId)
          .maybeSingle(),
        supabase
          .from("procurement_line_items")
          .select("id", { count: "exact", head: true })
          .eq("request_id", requestId),
      ]);
      const purchasingCategory = details?.purchasing_category_other || details?.purchasing_category;
      if (purchasingCategory) {
        rows.push({ label: "Purchasing category", value: escapeHtml(purchasingCategory) });
      }
      if (details?.vendor) rows.push({ label: "Vendor", value: escapeHtml(details.vendor) });
      const neededBy = formatEmailDate(details?.needed_by_date);
      if (neededBy) rows.push({ label: "Needed by", value: neededBy });
      if (count) rows.push({ label: "Items", value: `${count} item${count === 1 ? "" : "s"}` });
    }
  } catch (err) {
    console.error("Failed to fetch category details for email:", err);
  }

  return rows;
}

// `project_id` (a real Project row) takes precedence; `project` is only
// populated for the free-text "Other" option. Resolving here (rather than
// in every call site) keeps the "Project" row on every notification email
// showing an actual name instead of a blank or a raw UUID.
export async function resolveProjectName(
  supabase: SupabaseClient,
  project: string | null,
  projectId: string | null
): Promise<string | null> {
  if (project) return project;
  if (!projectId) return null;
  try {
    const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
    return data?.name ?? null;
  } catch {
    return null;
  }
}
