"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AttachmentFile } from "@/lib/types";

// Attachments (photos, permits, item images) are uploaded directly from the
// browser to Supabase Storage by the form (see uploadAttachment.ts) — this
// action only ever receives the resulting {name,url} pairs as JSON strings,
// never raw File objects. That keeps this Server Action's request body tiny,
// avoiding Vercel's Server Action / Serverless Function body-size limits
// that real photo uploads would otherwise exceed.
function parseAttachments(formData: FormData, key: string): AttachmentFile[] {
  const raw = formData.get(key) as string | null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is AttachmentFile => !!a && !!a.url) : [];
  } catch {
    return [];
  }
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
    const permit = parseAttachments(formData, "delivery_permit_json");

    await supabase.from("delivery_details").insert({
      request_id: request.id,
      delivery_location: formData.get("delivery_location") as string,
      requested_date: (formData.get("delivery_requested_date") as string) || null,
      requested_time: (formData.get("delivery_requested_time") as string) || null,
      files: permit,
    });

    const names = formData.getAll("delivery_item_name[]") as string[];
    const qtys = formData.getAll("delivery_item_qty[]") as string[];
    const locations = formData.getAll("delivery_item_location[]") as string[];
    const imageUrlsRaw = formData.get("delivery_item_image_urls_json") as string | null;
    let imageUrls: (string | null)[] = [];
    try {
      imageUrls = imageUrlsRaw ? JSON.parse(imageUrlsRaw) : [];
    } catch {
      imageUrls = [];
    }

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
    const photos = parseAttachments(formData, "maintenance_photos_json").slice(0, 6);
    const permit = parseAttachments(formData, "maintenance_work_permit_json");

    await supabase.from("maintenance_details").insert({
      request_id: request.id,
      location_area: formData.get("location_area") as string,
      maintenance_type: (formData.get("maintenance_type") as string) || null,
      urgency: (formData.get("urgency") as string) || "medium",
      scheduled_date: (formData.get("maintenance_date") as string) || null,
      scheduled_time: (formData.get("maintenance_time") as string) || null,
      photos,
      work_permit: permit,
    });
  }

  if (category === "labor") {
    const types = formData.getAll("labor_type[]") as string[];
    const quantities = formData.getAll("labor_qty[]") as string[];
    const natures = formData.getAll("labor_nature[]") as string[];
    const dateFrom = formData.get("labor_date_from") as string;
    const dateTo = formData.get("labor_date_to") as string;

    const rows = types
      .map((type, i) => ({
        request_id: request.id,
        personnel_type: type || null,
        quantity: parseInt(quantities[i] || "1", 10),
        date_from: dateFrom || null,
        date_to: dateTo || null,
        nature_of_work: natures[i] || null,
      }))
      .filter((r) => r.personnel_type);

    if (rows.length > 0) {
      await supabase.from("labor_personnel_lines").insert(rows);
    }
  }

  if (category === "procurement") {
    const purchasingCategory = (formData.get("purchasing_category") as string) || null;
    const purchasingCategoryOther =
      (formData.get("purchasing_category_other") as string) || null;
    const vendor = (formData.get("vendor") as string) || null;
    const neededByDate = (formData.get("procurement_needed_by") as string) || null;

    await supabase.from("procurement_details").insert({
      request_id: request.id,
      purchasing_category: purchasingCategory,
      purchasing_category_other: purchasingCategory === "other" ? purchasingCategoryOther : null,
      vendor,
      needed_by_date: neededByDate,
    });

    const names = formData.getAll("proc_item_name[]") as string[];
    const quantities = formData.getAll("proc_item_qty[]") as string[];
    const links = formData.getAll("proc_item_link[]") as string[];
    const imageUrlsRaw = formData.get("proc_item_image_urls_json") as string | null;
    let imageUrls: (string | null)[] = [];
    try {
      imageUrls = imageUrlsRaw ? JSON.parse(imageUrlsRaw) : [];
    } catch {
      imageUrls = [];
    }

    const itemRows = [];
    for (let i = 0; i < names.length; i++) {
      const itemName = (names[i] || "").trim();
      const link = (links[i] || "").trim();
      const qtyRaw = quantities[i];
      if (!itemName && !link && !qtyRaw) continue; // skip fully-empty rows

      itemRows.push({
        request_id: request.id,
        item_no: i + 1,
        item_description: itemName || `Item ${i + 1}`,
        quantity: parseInt(qtyRaw || "0", 10) || 0,
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
