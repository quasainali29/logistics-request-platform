"use server";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AttachmentFile, CostCategory } from "@/lib/types";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { sendNotificationEmail } from "@/lib/email";
import {
  buildRequestEmailHtml,
  escapeHtml,
  fetchCategoryDetails,
  formatEmailDate,
  resolveProjectName,
  type EmailDetailRow,
} from "@/lib/emailTemplates";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const BUCKET = "request-attachments";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

// Used by closeRequestWithDocuments, which still submits raw Files (the
// closeout forms are small — signed PDFs/photos at that stage — so they
// haven't needed the client-side pre-upload treatment createRequest uses).
async function uploadOne(
  supabase: SupabaseClient,
  folder: string,
  file: File
): Promise<AttachmentFile | null> {
  if (!file || file.size === 0) return null;
  const path = `${folder}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeName(file.name || "file")}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { name: file.name || "file", url: data.publicUrl };
}

async function uploadMany(
  supabase: SupabaseClient,
  folder: string,
  files: File[]
): Promise<AttachmentFile[]> {
  const results = await Promise.all(files.map((f) => uploadOne(supabase, folder, f)));
  return results.filter((r): r is AttachmentFile => r !== null);
}

// createRequest's attachments (photos, permits, item reference images) are
// uploaded directly to Supabase Storage from the browser first (see
// src/lib/uploadAttachment.ts) — that sidesteps Vercel's Server Action
// body-size limit for real photo/PDF uploads. What arrives here for those
// fields is a JSON-encoded array of already-uploaded {name, url} objects
// (or a list of plain URL strings for per-item images), never a raw File.
function parseAttachmentArray(formData: FormData, key: string): AttachmentFile[] {
  const raw = formData.get(key) as string | null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as (AttachmentFile | null)[];
    return parsed.filter((p): p is AttachmentFile => !!p && !!p.url);
  } catch {
    return [];
  }
}

function parseUrlArray(formData: FormData, key: string): (string | null)[] {
  const raw = formData.get(key) as string | null;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as (string | null)[];
  } catch {
    return [];
  }
}

async function currentUserIsManager(supabase: SupabaseClient, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role_info:roles!profiles_role_fkey(is_manager)")
    .eq("id", userId)
    .single();
  return !!(profile?.role_info as { is_manager: boolean } | null)?.is_manager;
}

// managerEditRequest needs a handful of joined fields (the requestor's
// contact info, the actor's role + is_manager flag) that Supabase's
// generated types resolve inconsistently for `!fk_name(...)` joins
// depending on how strongly-typed the calling client is. Routing the
// fetch through a `SupabaseClient`-typed (not the concrete generated
// client) helper -- same trick currentUserIsManager above already relies
// on -- sidesteps that entirely instead of fighting it with casts at each
// call site.
async function fetchManagerEditContext(
  supabase: SupabaseClient,
  requestId: string,
  userId: string
) {
  const [{ data: existing }, { data: actorProfile }] = await Promise.all([
    supabase
      .from("requests")
      .select(
        "*, requestor:profiles!requests_requestor_id_fkey(full_name, email)"
      )
      .eq("id", requestId)
      .single(),
    supabase
      .from("profiles")
      .select("*, role_info:roles!profiles_role_fkey(is_manager)")
      .eq("id", userId)
      .single(),
  ]);

  const requestor = (existing?.requestor as { full_name: string; email: string } | null) ?? null;
  const isManager = !!(actorProfile?.role_info as { is_manager: boolean } | null)?.is_manager;

  return {
    existing: existing
      ? {
          requestNumber: existing.request_number as string,
          category: existing.category as string,
          status: existing.status as string,
          requestorId: existing.requestor_id as string,
          title: existing.title as string,
          priority: existing.priority as string,
          project: existing.project as string | null,
          department: existing.department as string | null,
          dateRequired: existing.date_required as string | null,
          concludeDate: existing.conclude_date as string | null,
          requestorEmail: requestor?.email ?? null,
        }
      : null,
    actorFullName: (actorProfile?.full_name as string | undefined) ?? "A manager",
    actorRole: (actorProfile?.role as string | undefined) ?? null,
    isManager,
  };
}

export async function createRequest(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const category = formData.get("category") as string;

  // Rows describing category-specific fields worth surfacing on the
  // "new request" notification emails — populated below, alongside the
  // existing per-category insert logic, so no extra DB round-trip is
  // needed just to build the email.
  const categoryDetails: EmailDetailRow[] = [];

  // "Other" is a one-off free-text tag on this request only — it never
  // gets added to the master Projects list (see admin/projects). Picking
  // a real project instead links project_id, which is what powers
  // per-project reporting.
  const projectIdRaw = (formData.get("project_id") as string) || "";
  const projectOther = (formData.get("project_other") as string)?.trim() || "";
  let projectId: string | null = null;
  let projectText: string | null = null;

  if (projectIdRaw === "other") {
    if (!projectOther) {
      redirect(`/requests/new?error=${encodeURIComponent("Project name is required")}`);
    }
    projectText = projectOther;
  } else if (projectIdRaw) {
    projectId = projectIdRaw;
  } else {
    redirect(`/requests/new?error=${encodeURIComponent("Project is required")}`);
  }

  if (category === "delivery") {
    const deliveryLocation = (formData.get("delivery_location") as string)?.trim();
    if (!deliveryLocation) {
      redirect(`/requests/new?error=${encodeURIComponent("Delivery location is required")}`);
    }
  }

  const { data: request, error } = await supabase
    .from("requests")
    .insert({
      title: formData.get("title") as string,
      category,
      requestor_id: user.id,
      project_id: projectId,
      project: projectText,
      department: (formData.get("department") as string) || null,
      priority: (formData.get("priority") as string) || "medium",
      date_required: (formData.get("date_required") as string) || null,
      conclude_date: (formData.get("conclude_date") as string) || null,
      description: (formData.get("description") as string) || null,
      special_instructions: (formData.get("special_instructions") as string) || null,
    })
    .select()
    .single();

  if (error || !request) {
    redirect(`/requests/new?error=${encodeURIComponent(error?.message ?? "Could not create request")}`);
  }

  if (category === "delivery") {
    const permitFiles = parseAttachmentArray(formData, "delivery_permit_json");

    await supabase.from("delivery_details").insert({
      request_id: request.id,
      delivery_location: formData.get("delivery_location") as string,
      requested_date: (formData.get("delivery_requested_date") as string) || null,
      requested_time: (formData.get("delivery_requested_time") as string) || null,
      files: permitFiles,
    });

    const names = formData.getAll("delivery_item_name[]") as string[];
    const qtys = formData.getAll("delivery_item_qty[]") as string[];
    const locations = formData.getAll("delivery_item_location[]") as string[];
    const imageUrls = parseUrlArray(formData, "delivery_item_image_urls_json");

    const itemRows = [];
    for (let i = 0; i < names.length; i++) {
      const itemName = (names[i] || "").trim();
      const location = (locations[i] || "").trim();
      const qtyRaw = qtys[i];
      if (!itemName && !location && !qtyRaw) continue; // skip fully-empty rows

      itemRows.push({
        request_id: request.id,
        item_no: i + 1,
        item_name: itemName || `Item ${i + 1}`,
        required_quantity: parseFloat(qtyRaw || "0") || 0,
        image_url: imageUrls[i] ?? null,
        current_location: location || null,
      });
    }

    if (itemRows.length > 0) {
      await supabase.from("delivery_items").insert(itemRows);
    }

    const deliveryLocationVal = (formData.get("delivery_location") as string) || "";
    if (deliveryLocationVal) {
      categoryDetails.push({ label: "Delivery location", value: escapeHtml(deliveryLocationVal) });
    }
    const deliveryWhen = formatEmailDate(
      (formData.get("delivery_requested_date") as string) || null,
      (formData.get("delivery_requested_time") as string) || null
    );
    if (deliveryWhen) categoryDetails.push({ label: "Requested for", value: deliveryWhen });
    if (itemRows.length > 0) {
      categoryDetails.push({
        label: "Items",
        value: `${itemRows.length} item${itemRows.length === 1 ? "" : "s"}`,
      });
    }
  }

  if (category === "maintenance") {
    const photos = parseAttachmentArray(formData, "maintenance_photos_json");
    const workPermit = parseAttachmentArray(formData, "maintenance_work_permit_json");

    await supabase.from("maintenance_details").insert({
      request_id: request.id,
      location_area: formData.get("location_area") as string,
      maintenance_type: (formData.get("maintenance_type") as string) || null,
      urgency: (formData.get("urgency") as string) || "medium",
      scheduled_date: (formData.get("maintenance_date") as string) || null,
      scheduled_time: (formData.get("maintenance_time") as string) || null,
      photos,
      work_permit: workPermit,
    });

    const locationAreaVal = (formData.get("location_area") as string) || "";
    if (locationAreaVal) {
      categoryDetails.push({ label: "Location / area", value: escapeHtml(locationAreaVal) });
    }
    const maintenanceTypeVal = (formData.get("maintenance_type") as string) || "";
    if (maintenanceTypeVal) {
      categoryDetails.push({ label: "Maintenance type", value: escapeHtml(maintenanceTypeVal) });
    }
    const urgencyVal = (formData.get("urgency") as string) || "medium";
    categoryDetails.push({
      label: "Urgency",
      value: urgencyVal.charAt(0).toUpperCase() + urgencyVal.slice(1),
    });
    const maintenanceWhen = formatEmailDate(
      (formData.get("maintenance_date") as string) || null,
      (formData.get("maintenance_time") as string) || null
    );
    if (maintenanceWhen) categoryDetails.push({ label: "Scheduled for", value: maintenanceWhen });
    if (photos.length > 0) {
      categoryDetails.push({ label: "Photos attached", value: `${photos.length}` });
    }
  }

  if (category === "labor") {
    const types = formData.getAll("labor_type[]") as string[];
    const quantities = formData.getAll("labor_qty[]") as string[];
    const dateFrom = formData.get("labor_date_from") as string;
    const dateTo = formData.get("labor_date_to") as string;
    const natureOfWork = formData.get("nature_of_work") as string;

    const rows = types
      .map((type, i) => ({
        request_id: request.id,
        personnel_type: type,
        quantity: parseInt(quantities[i] || "1", 10),
        date_from: dateFrom || null,
        date_to: dateTo || null,
        nature_of_work: natureOfWork || null,
      }))
      .filter((r) => r.personnel_type);

    if (rows.length > 0) {
      await supabase.from("labor_personnel_lines").insert(rows);

      const summary = rows.map((r) => `${r.quantity}× ${r.personnel_type}`).join(", ");
      categoryDetails.push({ label: "Personnel", value: escapeHtml(summary) });
      const from = formatEmailDate(dateFrom || null);
      const to = formatEmailDate(dateTo || null);
      const when = from && to ? `${from} to ${to}` : from ?? to;
      if (when) categoryDetails.push({ label: "Dates", value: when });
      if (natureOfWork) {
        categoryDetails.push({ label: "Nature of work", value: escapeHtml(natureOfWork) });
      }
    }
  }

  if (category === "procurement") {
    await supabase.from("procurement_details").insert({
      request_id: request.id,
      purchasing_category: (formData.get("purchasing_category") as string) || null,
      purchasing_category_other: (formData.get("purchasing_category_other") as string) || null,
      vendor: (formData.get("vendor") as string) || null,
      needed_by_date: (formData.get("procurement_needed_by") as string) || null,
    });

    const names = formData.getAll("proc_item_name[]") as string[];
    const qtys = formData.getAll("proc_item_qty[]") as string[];
    const links = formData.getAll("proc_item_link[]") as string[];
    const imageUrls = parseUrlArray(formData, "proc_item_image_urls_json");

    const itemRows = [];
    for (let i = 0; i < names.length; i++) {
      const itemName = (names[i] || "").trim();
      const link = (links[i] || "").trim();
      const qtyRaw = qtys[i];
      if (!itemName && !link && !qtyRaw) continue; // skip fully-empty rows

      itemRows.push({
        request_id: request.id,
        item_no: i + 1,
        item_description: itemName || `Item ${i + 1}`,
        quantity: parseInt(qtyRaw || "1", 10) || 1,
        image_url: imageUrls[i] ?? null,
        purchasing_link: link || null,
      });
    }

    if (itemRows.length > 0) {
      await supabase.from("procurement_line_items").insert(itemRows);
    }

    const purchasingCategoryRaw = (formData.get("purchasing_category") as string) || "";
    const purchasingCategoryOther = (formData.get("purchasing_category_other") as string) || "";
    const purchasingCategoryVal = purchasingCategoryOther || purchasingCategoryRaw;
    if (purchasingCategoryVal) {
      categoryDetails.push({ label: "Purchasing category", value: escapeHtml(purchasingCategoryVal) });
    }
    const vendorVal = (formData.get("vendor") as string) || "";
    if (vendorVal) categoryDetails.push({ label: "Vendor", value: escapeHtml(vendorVal) });
    const neededByVal = formatEmailDate((formData.get("procurement_needed_by") as string) || null);
    if (neededByVal) categoryDetails.push({ label: "Needed by", value: neededByVal });
    if (itemRows.length > 0) {
      categoryDetails.push({
        label: "Items",
        value: `${itemRows.length} item${itemRows.length === 1 ? "" : "s"}`,
      });
    }
  }

  // Best-effort notifications for the two audiences that care about a
  // brand-new submission: the logistics managers who need to review/approve
  // it, and the requestor who wants confirmation it went in. Never block
  // request creation itself on an email failure.
  try {
    const [{ data: managers }, { data: requestorProfile }] = await Promise.all([
      supabase.from("profiles").select("email").eq("role", "logistics_manager").eq("status", "active"),
      supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    ]);

    const managerEmails = (managers ?? []).map((m) => m.email).filter(Boolean);
    const link = `${APP_URL}/requests/${request.id}`;
    const requestorName = requestorProfile?.full_name ?? "A team member";
    const projectName = await resolveProjectName(supabase, request.project, request.project_id);

    const sharedFields = {
      requestNumber: request.request_number,
      title: request.title,
      category: request.category,
      priority: request.priority,
      project: projectName,
      department: request.department,
      dateRequired: request.date_required,
      concludeDate: request.conclude_date,
      description: request.description,
      specialInstructions: request.special_instructions,
      categoryDetails,
    };

    if (managerEmails.length > 0) {
      await sendNotificationEmail({
        to: managerEmails,
        subject: `New request needs review: ${request.title}`,
        html: buildRequestEmailHtml({
          ...sharedFields,
          requestorName,
          headline: "New request needs your review",
          ctaLabel: "Review and approve request",
          ctaUrl: link,
        }),
      });
    }

    if (user.email) {
      await sendNotificationEmail({
        to: user.email,
        subject: `${request.request_number} has been submitted`,
        html: buildRequestEmailHtml({
          ...sharedFields,
          headline: "Your request has been submitted",
          ctaLabel: "View request",
          ctaUrl: link,
        }),
      });
    }
  } catch (err) {
    console.error("Failed to send request-creation notifications:", err);
  }

  revalidatePath("/requests");
  redirect(`/requests/${request.id}`);
}

// Shared by updateRequest (owner rectify-and-resubmit) and
// managerEditRequest (manager/coordinator correction) -- both flows edit
// the exact same set of fields and category-detail tables, and only
// differ in who's allowed to call them, when, and what happens to
// `status` and the resulting notification. Pulling the field-parsing and
// persistence logic out here means those two concerns can never drift
// out of sync with each other.
//
// statusOverride is omitted entirely for the manager path -- the request
// stays wherever it was in the workflow, since this is a correction to a
// request still in flight, not a resubmission into the approval queue.
async function applyRequestEdits(
  supabase: SupabaseClient,
  requestId: string,
  formData: FormData,
  category: string,
  statusOverride?: string
) {
  const projectIdRaw = (formData.get("project_id") as string) || "";
  const projectOther = (formData.get("project_other") as string)?.trim() || "";
  let projectId: string | null = null;
  let projectText: string | null = null;

  if (projectIdRaw === "other") {
    if (!projectOther) {
      redirect(`/requests/${requestId}/edit?error=${encodeURIComponent("Project name is required")}`);
    }
    projectText = projectOther;
  } else if (projectIdRaw) {
    projectId = projectIdRaw;
  } else {
    redirect(`/requests/${requestId}/edit?error=${encodeURIComponent("Project is required")}`);
  }

  if (category === "delivery") {
    const deliveryLocation = (formData.get("delivery_location") as string)?.trim();
    if (!deliveryLocation) {
      redirect(
        `/requests/${requestId}/edit?error=${encodeURIComponent("Delivery location is required")}`
      );
    }
  }

  // Two near-identical branches instead of one dynamically-built payload
  // object: the Supabase client's generated row types don't narrow well
  // through an intermediate Record<string, unknown>, so this keeps both
  // .update() calls fully type-checked against the real `requests` row
  // shape.
  if (statusOverride) {
    const { error } = await supabase
      .from("requests")
      .update({
        title: formData.get("title") as string,
        project_id: projectId,
        project: projectText,
        department: (formData.get("department") as string) || null,
        priority: (formData.get("priority") as string) || "medium",
        date_required: (formData.get("date_required") as string) || null,
        conclude_date: (formData.get("conclude_date") as string) || null,
        description: (formData.get("description") as string) || null,
        special_instructions: (formData.get("special_instructions") as string) || null,
        status: statusOverride,
      })
      .eq("id", requestId);

    if (error) {
      redirect(`/requests/${requestId}/edit?error=${encodeURIComponent(error.message)}`);
    }
  } else {
    const { error } = await supabase
      .from("requests")
      .update({
        title: formData.get("title") as string,
        project_id: projectId,
        project: projectText,
        department: (formData.get("department") as string) || null,
        priority: (formData.get("priority") as string) || "medium",
        date_required: (formData.get("date_required") as string) || null,
        conclude_date: (formData.get("conclude_date") as string) || null,
        description: (formData.get("description") as string) || null,
        special_instructions: (formData.get("special_instructions") as string) || null,
      })
      .eq("id", requestId);

    if (error) {
      redirect(`/requests/${requestId}/edit?error=${encodeURIComponent(error.message)}`);
    }
  }

  if (category === "delivery") {
    const permitFiles = parseAttachmentArray(formData, "delivery_permit_json");
    const existingPermit = parseAttachmentArray(formData, "delivery_permit_existing_json");

    await supabase
      .from("delivery_details")
      .update({
        delivery_location: formData.get("delivery_location") as string,
        requested_date: (formData.get("delivery_requested_date") as string) || null,
        requested_time: (formData.get("delivery_requested_time") as string) || null,
        files: permitFiles.length > 0 ? permitFiles : existingPermit,
      })
      .eq("request_id", requestId);

    const names = formData.getAll("delivery_item_name[]") as string[];
    const qtys = formData.getAll("delivery_item_qty[]") as string[];
    const locations = formData.getAll("delivery_item_location[]") as string[];
    const imageUrls = parseUrlArray(formData, "delivery_item_image_urls_json");

    const itemRows = [];
    for (let i = 0; i < names.length; i++) {
      const itemName = (names[i] || "").trim();
      const location = (locations[i] || "").trim();
      const qtyRaw = qtys[i];
      if (!itemName && !location && !qtyRaw) continue;

      itemRows.push({
        request_id: requestId,
        item_no: i + 1,
        item_name: itemName || `Item ${i + 1}`,
        required_quantity: parseFloat(qtyRaw || "0") || 0,
        image_url: imageUrls[i] ?? null,
        current_location: location || null,
      });
    }

    await supabase.from("delivery_items").delete().eq("request_id", requestId);
    if (itemRows.length > 0) {
      await supabase.from("delivery_items").insert(itemRows);
    }
  }

  if (category === "maintenance") {
    const photos = parseAttachmentArray(formData, "maintenance_photos_json");
    const workPermit = parseAttachmentArray(formData, "maintenance_work_permit_json");
    const existingPhotos = parseAttachmentArray(formData, "maintenance_photos_existing_json");
    const existingWorkPermit = parseAttachmentArray(
      formData,
      "maintenance_work_permit_existing_json"
    );

    await supabase
      .from("maintenance_details")
      .update({
        location_area: formData.get("location_area") as string,
        maintenance_type: (formData.get("maintenance_type") as string) || null,
        urgency: (formData.get("urgency") as string) || "medium",
        scheduled_date: (formData.get("maintenance_date") as string) || null,
        scheduled_time: (formData.get("maintenance_time") as string) || null,
        // Only replace attachments if the requester actually uploaded new
        // ones — otherwise keep what was already on the request.
        photos: photos.length > 0 ? photos : existingPhotos,
        work_permit: workPermit.length > 0 ? workPermit : existingWorkPermit,
      })
      .eq("request_id", requestId);
  }

  if (category === "labor") {
    const types = formData.getAll("labor_type[]") as string[];
    const quantities = formData.getAll("labor_qty[]") as string[];
    const dateFrom = formData.get("labor_date_from") as string;
    const dateTo = formData.get("labor_date_to") as string;
    const natureOfWork = formData.get("nature_of_work") as string;

    const rows = types
      .map((type, i) => ({
        request_id: requestId,
        personnel_type: type,
        quantity: parseInt(quantities[i] || "1", 10),
        date_from: dateFrom || null,
        date_to: dateTo || null,
        nature_of_work: natureOfWork || null,
      }))
      .filter((r) => r.personnel_type);

    await supabase.from("labor_personnel_lines").delete().eq("request_id", requestId);
    if (rows.length > 0) {
      await supabase.from("labor_personnel_lines").insert(rows);
    }
  }

  if (category === "procurement") {
    await supabase
      .from("procurement_details")
      .update({
        purchasing_category: (formData.get("purchasing_category") as string) || null,
        purchasing_category_other: (formData.get("purchasing_category_other") as string) || null,
        vendor: (formData.get("vendor") as string) || null,
        needed_by_date: (formData.get("procurement_needed_by") as string) || null,
      })
      .eq("request_id", requestId);

    const names = formData.getAll("proc_item_name[]") as string[];
    const qtys = formData.getAll("proc_item_qty[]") as string[];
    const links = formData.getAll("proc_item_link[]") as string[];
    const imageUrls = parseUrlArray(formData, "proc_item_image_urls_json");

    const itemRows = [];
    for (let i = 0; i < names.length; i++) {
      const itemName = (names[i] || "").trim();
      const link = (links[i] || "").trim();
      const qtyRaw = qtys[i];
      if (!itemName && !link && !qtyRaw) continue;

      itemRows.push({
        request_id: requestId,
        item_no: i + 1,
        item_description: itemName || `Item ${i + 1}`,
        quantity: parseInt(qtyRaw || "1", 10) || 1,
        image_url: imageUrls[i] ?? null,
        purchasing_link: link || null,
      });
    }

    if (itemRows.length > 0) {
      await supabase.from("procurement_line_items").insert(itemRows);
    }
  }
}

export async function updateRequest(requestId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("requests")
    .select("requestor_id, status, category")
    .eq("id", requestId)
    .single();

  if (!existing) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent("Request not found")}`);
  }

  // Only the original requestor can edit, and only while the request is
  // sitting in "Returned for Info" — this is the rectify-and-resubmit path,
  // not a general-purpose edit feature. (Managers/coordinators have a
  // separate, broader path — see managerEditRequest below.)
  if (existing!.requestor_id !== user.id || existing!.status !== "returned_for_info") {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "This request can't be edited right now."
      )}`
    );
  }

  const category = existing!.category as string;

  // Resubmitting: same request row/number, straight back into the
  // approval queue (status -> submitted triggers the normal Approve/Reject
  // flow again).
  await applyRequestEdits(supabase, requestId, formData, category, "submitted");

  try {
    await fetch(`${APP_URL}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status: "submitted" }),
    });
  } catch {
    // Email failures should never block the resubmit itself.
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  redirect(`/requests/${requestId}`);
}

// A manager or logistics coordinator correcting a request that's still
// active -- e.g. pushing a due date back because the original timeframe
// isn't achievable. Unlike updateRequest above, this doesn't touch
// `status` (the request stays wherever it is in the workflow) and doesn't
// require the caller to be the requestor. A reason is mandatory and, along
// with a summary of what actually changed, gets logged as a comment on the
// request and emailed to the requestor.
export async function managerEditRequest(requestId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { existing, actorFullName, actorRole, isManager } = await fetchManagerEditContext(
    supabase,
    requestId,
    user.id
  );

  if (!existing) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent("Request not found")}`);
  }

  const isCoordinator = actorRole === "logistics_coordinator";
  if (!isManager && !isCoordinator) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "Only managers and coordinators can edit a request this way."
      )}`
    );
  }

  const category = existing!.category;
  const status = existing!.status;

  // Can't correct a request that's already reached a terminal stage for
  // its category (e.g. Closed) -- there's nothing left in flight to fix.
  const stages = await getWorkflowStages();
  const stage = stages.find((s) => s.category === category && s.key === status);
  if (stage?.is_terminal) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "This request is closed and can no longer be edited."
      )}`
    );
  }

  const reason = ((formData.get("edit_reason") as string) || "").trim();
  if (!reason) {
    redirect(
      `/requests/${requestId}/edit?error=${encodeURIComponent(
        "A reason is required when editing someone else's request."
      )}`
    );
  }

  // Snapshot the fields worth calling out to the requestor before they're
  // overwritten -- diffed against the newly-submitted form values below.
  const before = {
    title: existing!.title,
    priority: existing!.priority,
    date_required: existing!.dateRequired,
    conclude_date: existing!.concludeDate,
    projectName: existing!.project,
  };

  await applyRequestEdits(supabase, requestId, formData, category);

  const after = {
    title: (formData.get("title") as string) || "",
    priority: (formData.get("priority") as string) || "medium",
    date_required: (formData.get("date_required") as string) || null,
    conclude_date: (formData.get("conclude_date") as string) || null,
  };

  const changeNotes: string[] = [];
  if (before.title !== after.title) {
    changeNotes.push(`Title changed from "${before.title}" to "${after.title}"`);
  }
  if (before.priority !== after.priority) {
    changeNotes.push(
      `Priority changed from ${capitalize(before.priority)} to ${capitalize(after.priority)}`
    );
  }
  if (before.date_required !== after.date_required) {
    changeNotes.push(
      `Date required changed from ${formatEmailDate(before.date_required) ?? "—"} to ${
        formatEmailDate(after.date_required) ?? "—"
      }`
    );
  }
  if (before.conclude_date !== after.conclude_date) {
    changeNotes.push(
      `Conclude by changed from ${formatEmailDate(before.conclude_date) ?? "—"} to ${
        formatEmailDate(after.conclude_date) ?? "—"
      }`
    );
  }

  const changeSummary = changeNotes.length > 0 ? changeNotes.join("; ") : "Request details updated";

  await supabase.from("comments").insert({
    request_id: requestId,
    author_id: user.id,
    comment: `${changeSummary}. Reason: ${reason}`,
  });

  if (existing!.requestorEmail && existing!.requestorId !== user.id) {
    try {
      // Re-derive the project the same way applyRequestEdits just parsed
      // it, so the notification reflects whatever was actually saved.
      const afterProjectIdRaw = (formData.get("project_id") as string) || "";
      const afterProjectOther = (formData.get("project_other") as string)?.trim() || "";
      const afterProjectId = afterProjectIdRaw && afterProjectIdRaw !== "other" ? afterProjectIdRaw : null;
      const afterProjectText = afterProjectIdRaw === "other" ? afterProjectOther : null;

      const [categoryDetails, projectName] = await Promise.all([
        fetchCategoryDetails(supabase, category, requestId),
        resolveProjectName(supabase, afterProjectText, afterProjectId),
      ]);
      const link = `${APP_URL}/requests/${requestId}`;

      await sendNotificationEmail({
        to: existing!.requestorEmail,
        subject: `${existing!.requestNumber} was updated by ${actorFullName}`,
        html: buildRequestEmailHtml({
          requestNumber: existing!.requestNumber,
          title: after.title,
          category,
          priority: after.priority,
          project: projectName ?? before.projectName,
          department: existing!.department,
          dateRequired: after.date_required,
          concludeDate: after.conclude_date,
          categoryDetails,
          reason: `${changeSummary}. — ${reason}`,
          headline: `${actorFullName} updated your request`,
          ctaLabel: "View request",
          ctaUrl: link,
        }),
      });
    } catch (err) {
      console.error("Failed to send request-edit notification email:", err);
    }
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  redirect(`/requests/${requestId}`);
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function updateRequestStatus(
  requestId: string,
  status: string,
  notes?: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: request }, { data: profile }] = await Promise.all([
    supabase
      .from("requests")
      .select("category, status, requestor_id")
      .eq("id", requestId)
      .single(),
    supabase
      .from("profiles")
      .select("role, role_info:roles!profiles_role_fkey(is_manager)")
      .eq("id", user.id)
      .single(),
  ]);

  if (!request) {
    redirect(`/requests/${requestId}?error=Request+not+found`);
  }

  const isManager = !!(profile?.role_info as unknown as { is_manager: boolean } | null)
    ?.is_manager;
  const isOwnerResubmit =
    request.requestor_id === user.id &&
    request.status === "returned_for_info" &&
    status === "submitted";

  if (!isOwnerResubmit && !isManager) {
    // Every other transition must be explicitly allowed by the configured
    // workflow for this category — closes the gap where any staff member
    // could previously set any status regardless of the button they saw.
    const { data: transition } = await supabase
      .from("workflow_transitions")
      .select("allowed_roles")
      .eq("category", request.category)
      .eq("from_key", request.status)
      .eq("to_key", status)
      .maybeSingle();

    const allowed = transition?.allowed_roles?.includes(profile?.role ?? "") ?? false;
    if (!allowed) {
      redirect(
        `/requests/${requestId}?error=${encodeURIComponent(
          "You don't have permission to make this change."
        )}`
      );
    }
  }

  const updates: Record<string, unknown> = { status };
  if (status === "approved") {
    updates.approved_by = user.id;
    updates.approval_date = new Date().toISOString().slice(0, 10);
  }

  await supabase.from("requests").update(updates).eq("id", requestId);

  if (notes) {
    await supabase.from("comments").insert({
      request_id: requestId,
      author_id: user.id,
      comment: notes,
    });
  }

  // Fire the email notification for this transition (best-effort, non-blocking).
  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status }),
    });
  } catch {
    // Email failures should never block the workflow action itself.
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function approveAndAssignRequest(requestId: string, coordinatorId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isManager = await currentUserIsManager(supabase, user.id);
  if (!isManager) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "Only managers can approve requests."
      )}`
    );
  }

  if (!coordinatorId) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "Please select a coordinator to assign."
      )}`
    );
  }

  const [{ data: coordinator }, { data: request }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", coordinatorId).single(),
    supabase
      .from("requests")
      .select(
        "request_number, title, category, priority, project, project_id, department, date_required, conclude_date, description, special_instructions"
      )
      .eq("id", requestId)
      .single(),
  ]);

  // Two sequential updates (rather than one combined update) so the
  // "requests_log_status" trigger records both transitions distinctly in
  // status_history — the request's history should show "Approved" as its
  // own step before "Under Process" (displayed as "Team Assigned" for
  // maintenance), matching the requested workflow instead of collapsing
  // both into a single jump straight to Under Process.
  const { error: approveError } = await supabase
    .from("requests")
    .update({
      status: "approved",
      approved_by: user.id,
      approval_date: new Date().toISOString().slice(0, 10),
    })
    .eq("id", requestId);

  if (approveError) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent(approveError.message)}`);
  }

  const { error } = await supabase
    .from("requests")
    .update({
      status: "under_process",
      owner_id: coordinatorId,
    })
    .eq("id", requestId);

  if (error) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent(error.message)}`);
  }

  if (coordinator?.email && request) {
    const [categoryDetails, projectName] = await Promise.all([
      fetchCategoryDetails(supabase, request.category, requestId),
      resolveProjectName(supabase, request.project, request.project_id),
    ]);

    await sendNotificationEmail({
      to: coordinator.email,
      subject: `You've been assigned: ${request.request_number}`,
      html: buildRequestEmailHtml({
        requestNumber: request.request_number,
        title: request.title,
        category: request.category,
        priority: request.priority,
        project: projectName,
        department: request.department,
        dateRequired: request.date_required,
        concludeDate: request.conclude_date,
        description: request.description,
        specialInstructions: request.special_instructions,
        categoryDetails,
        headline: `Hi ${coordinator.full_name}, you've been assigned a request`,
        ctaLabel: "View and start work",
        ctaUrl: `${APP_URL}/requests/${requestId}`,
      }),
    });
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function rejectRequest(requestId: string, reason?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isManager = await currentUserIsManager(supabase, user.id);
  if (!isManager) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "Only managers can reject requests."
      )}`
    );
  }

  // All categories use a rework loop instead of a terminal rejection: the
  // request goes back to the requestor as "Returned for Info" with a
  // mandatory reason, and resubmitting (same request number) puts it back
  // in the approval queue.
  if (!reason || !reason.trim()) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "A reason is required to return this request for info."
      )}`
    );
  }

  const newStatus = "returned_for_info";

  const { error } = await supabase
    .from("requests")
    .update({ status: newStatus })
    .eq("id", requestId);

  if (error) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent(error.message)}`);
  }

  if (reason && reason.trim()) {
    await supabase.from("comments").insert({
      request_id: requestId,
      author_id: user.id,
      comment: `Returned for info: ${reason.trim()}`,
    });
  }

  try {
    await fetch(`${APP_URL}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status: newStatus, reason: reason.trim() }),
    });
  } catch {
    // Email failures should never block the workflow action itself.
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

// Parses the itemized "Cost incurred" rows from the closeout form
// (cost_line_category[] / cost_line_description[] / cost_line_amount[])
// into request_cost_lines insert rows. Shared by every category — unlike
// the older category-specific cost fields (labor_closeout_lines,
// request_closeouts.total_value), this is the one cost source that feeds
// the Cost report. Rows with a zero/blank amount are dropped.
function parseCostLines(
  formData: FormData,
  requestId: string,
  addedBy: string
): { request_id: string; cost_category: CostCategory; description: string | null; amount: number; added_by: string }[] {
  const categories = formData.getAll("cost_line_category[]") as string[];
  const descriptions = formData.getAll("cost_line_description[]") as string[];
  const amounts = formData.getAll("cost_line_amount[]") as string[];

  const validCategories = new Set(["materials", "labor", "transport", "other"]);

  return categories
    .map((cat, i) => {
      const amount = parseFloat(amounts[i] || "0") || 0;
      const description = (descriptions[i] || "").trim();
      const category = (validCategories.has(cat) ? cat : "other") as CostCategory;
      return {
        request_id: requestId,
        cost_category: category,
        description: description || null,
        amount,
        added_by: addedBy,
      };
    })
    .filter((l) => l.amount > 0);
}

export async function closeRequestWithDocuments(requestId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: request } = await supabase
    .from("requests")
    .select("category, status")
    .eq("id", requestId)
    .single();

  if (!request) {
    redirect(`/requests/${requestId}?error=Request+not+found`);
  }

  const category = request.category as string;
  const closeoutRow: Record<string, unknown> = { request_id: requestId, closed_by: user.id };

  if (category === "delivery") {
    const deliveryLocation = (formData.get("delivery_location") as string)?.trim();
    const noteFile = formData.get("delivery_note") as File | null;
    const note =
      noteFile && noteFile.size > 0
        ? await uploadOne(supabase, `closeout/${requestId}`, noteFile)
        : null;

    if (!deliveryLocation || !note) {
      redirect(
        `/requests/${requestId}?error=${encodeURIComponent(
          "Delivery note and delivery location are required to close this request."
        )}`
      );
    }

    closeoutRow.delivery_note = note;
    closeoutRow.delivery_location = deliveryLocation;
  } else if (category === "labor") {
    const sheetFile = formData.get("labor_sheet") as File | null;
    const sheet =
      sheetFile && sheetFile.size > 0
        ? await uploadOne(supabase, `closeout/${requestId}`, sheetFile)
        : null;

    if (!sheet) {
      redirect(
        `/requests/${requestId}?error=${encodeURIComponent(
          "A labor sheet is required to close this request."
        )}`
      );
    }
    closeoutRow.labor_sheet = sheet;

    const types = formData.getAll("cost_type[]") as string[];
    const qtys = formData.getAll("cost_qty[]") as string[];
    const costs = formData.getAll("cost_rate[]") as string[];
    const lines = types
      .map((t, i) => ({
        request_id: requestId,
        personnel_type: (t || "").trim(),
        quantity: parseInt(qtys[i] || "1", 10) || 1,
        cost_per_labor: parseFloat(costs[i] || "0") || 0,
      }))
      .filter((l) => l.personnel_type);

    await supabase.from("labor_closeout_lines").delete().eq("request_id", requestId);
    if (lines.length > 0) {
      await supabase.from("labor_closeout_lines").insert(lines);
    }
  } else if (category === "maintenance") {
    const formFile = formData.get("maintenance_form") as File | null;
    const signedForm =
      formFile && formFile.size > 0
        ? await uploadOne(supabase, `closeout/${requestId}`, formFile)
        : null;
    const photoFiles = (formData.getAll("maintenance_photos") as File[]).filter(
      (f) => f && f.size > 0
    );

    if (!signedForm || photoFiles.length === 0) {
      redirect(
        `/requests/${requestId}?error=${encodeURIComponent(
          "A signed maintenance form and at least one photo are required to close this request."
        )}`
      );
    }

    const photos = await uploadMany(supabase, `closeout/${requestId}`, photoFiles);
    closeoutRow.maintenance_form = signedForm;
    closeoutRow.maintenance_photos = photos;
  } else if (category === "procurement") {
    const invoiceFile = formData.get("invoice") as File | null;
    const invoice =
      invoiceFile && invoiceFile.size > 0
        ? await uploadOne(supabase, `closeout/${requestId}`, invoiceFile)
        : null;
    const photoFiles = (formData.getAll("procurement_photos") as File[]).filter(
      (f) => f && f.size > 0
    );
    const deliveryLocation = (formData.get("delivery_location") as string)?.trim();
    const totalValueRaw = formData.get("total_value") as string;

    if (!invoice || photoFiles.length === 0 || !deliveryLocation) {
      redirect(
        `/requests/${requestId}?error=${encodeURIComponent(
          "An invoice, at least one item photo, and a delivery location are required to close this request."
        )}`
      );
    }

    const photos = await uploadMany(supabase, `closeout/${requestId}`, photoFiles);
    closeoutRow.invoice = invoice;
    closeoutRow.procurement_photos = photos;
    closeoutRow.delivery_location = deliveryLocation;
    closeoutRow.total_value = parseFloat(totalValueRaw || "0") || 0;
  }

  const { error: upsertError } = await supabase
    .from("request_closeouts")
    .upsert(closeoutRow, { onConflict: "request_id" });

  if (upsertError) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent(upsertError.message)}`);
  }

  const { error } = await supabase
    .from("requests")
    .update({ status: "closed" })
    .eq("id", requestId);

  if (error) {
    redirect(`/requests/${requestId}?error=${encodeURIComponent(error.message)}`);
  }

  // Itemized cost lines entered on the closeout form — replaces any prior
  // lines for this request so re-closing (e.g. after being reopened) never
  // duplicates them. Best-effort: a failure here shouldn't block the
  // closeout itself, since the request is already closed at this point.
  try {
    const costLines = parseCostLines(formData, requestId, user.id);
    await supabase.from("request_cost_lines").delete().eq("request_id", requestId);
    if (costLines.length > 0) {
      await supabase.from("request_cost_lines").insert(costLines);
    }
  } catch (err) {
    console.error("Failed to save cost lines at closeout:", err);
  }

  try {
    await fetch(`${APP_URL}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status: "closed" }),
    });
  } catch {
    // Email failures should never block the workflow action itself.
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function deleteRequests(requestIds: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role_info:roles!profiles_role_fkey(is_manager)")
    .eq("id", user.id)
    .single();

  const isManager = !!(profile?.role_info as { is_manager: boolean } | null)?.is_manager;
  if (!isManager) {
    redirect(`/requests?error=${encodeURIComponent("You don't have permission to delete requests.")}`);
  }

  const ids = requestIds.filter(Boolean);
  if (ids.length === 0) return;

  const { error } = await supabase.from("requests").delete().in("id", ids);

  if (error) {
    redirect(`/requests?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/requests");
}

// mentionedUserIds are the accounts @tagged in this comment -- any active
// account works here, not just logistics staff, since the mention picker
// in the UI lists every active profile regardless of role or department.
export async function addComment(
  requestId: string,
  comment: string,
  mentionedUserIds: string[] = []
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const uniqueMentionIds = Array.from(new Set(mentionedUserIds)).filter(Boolean);

  await supabase.from("comments").insert({
    request_id: requestId,
    author_id: user.id,
    comment,
    mentioned_user_ids: uniqueMentionIds,
  });

  revalidatePath(`/requests/${requestId}`);

  // Email whoever was tagged (best-effort -- a failed send never blocks the
  // comment itself, same pattern as every other notification in the app).
  // The author doesn't get emailed for tagging themselves.
  const notifyIds = uniqueMentionIds.filter((id) => id !== user.id);
  if (notifyIds.length === 0) return;

  try {
    const [{ data: mentionedProfiles }, { data: authorProfile }, { data: reqRow }] =
      await Promise.all([
        supabase.from("profiles").select("id, full_name, email").in("id", notifyIds),
        supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
        supabase.from("requests").select("request_number, title").eq("id", requestId).maybeSingle(),
      ]);

    const link = `${APP_URL}/requests/${requestId}`;
    const authorName = authorProfile?.full_name ?? "Someone";

    await Promise.all(
      (mentionedProfiles ?? [])
        .filter((p) => p.email)
        .map((p) =>
          sendNotificationEmail({
            to: p.email as string,
            subject: `${authorName} mentioned you on ${reqRow?.request_number ?? "a request"}`,
            html: `<p><strong>${escapeHtml(authorName)}</strong> mentioned you in a comment on <strong>${escapeHtml(
              reqRow?.title ?? ""
            )}</strong> (${escapeHtml(reqRow?.request_number ?? "")}):</p><p style="padding:10px 14px;background:#f8fafc;border-radius:6px;color:#0f172a;">${escapeHtml(
              comment
            )}</p><p><a href="${link}">View request</a></p>`,
          })
        )
    );
  } catch (err) {
    console.error("Failed to send mention notification email:", err);
  }
}
