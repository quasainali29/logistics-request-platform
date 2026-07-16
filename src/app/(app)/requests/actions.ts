"use server";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AttachmentFile } from "@/lib/types";
import { sendNotificationEmail } from "@/lib/email";

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

export async function createRequest(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const category = formData.get("category") as string;
  const project = (formData.get("project") as string)?.trim();

  if (!project) {
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
      project,
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
  }

  revalidatePath("/requests");
  redirect(`/requests/${request.id}`);
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
    supabase.from("requests").select("request_number, title").eq("id", requestId).single(),
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

  if (coordinator?.email) {
    await sendNotificationEmail({
      to: coordinator.email,
      subject: `You've been assigned: ${request?.request_number ?? "a request"}`,
      html: `<p>Hi ${coordinator.full_name},</p><p>You've been assigned to handle request <strong>${
        request?.request_number ?? ""
      }</strong> — ${request?.title ?? ""}.</p><p><a href="${APP_URL}/requests/${requestId}">View request</a></p>`,
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

  const { data: request } = await supabase
    .from("requests")
    .select("category")
    .eq("id", requestId)
    .single();

  // Maintenance requests use a rework loop instead of a terminal rejection:
  // the request goes back to the requestor as "Returned for Info" with a
  // mandatory reason, and resubmitting (same request number) puts it back
  // in the approval queue. Every other category keeps the original
  // terminal "rejected" status with an optional reason.
  const isMaintenance = request?.category === "maintenance";

  if (isMaintenance && (!reason || !reason.trim())) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "A reason is required to return this request for info."
      )}`
    );
  }

  const newStatus = isMaintenance ? "returned_for_info" : "rejected";

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
      comment: `${isMaintenance ? "Returned for info" : "Rejected"}: ${reason.trim()}`,
    });
  }

  try {
    await fetch(`${APP_URL}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status: newStatus }),
    });
  } catch {
    // Email failures should never block the workflow action itself.
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
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

export async function addComment(requestId: string, comment: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.from("comments").insert({
    request_id: requestId,
    author_id: user.id,
    comment,
  });

  revalidatePath(`/requests/${requestId}`);
}
