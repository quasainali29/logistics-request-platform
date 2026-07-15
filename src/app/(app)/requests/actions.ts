"use server";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AttachmentFile } from "@/lib/types";

const BUCKET = "request-attachments";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

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
    const permitFile = formData.get("delivery_permit") as File | null;
    const permit = permitFile
      ? await uploadOne(supabase, `delivery/${request.id}`, permitFile)
      : null;

    await supabase.from("delivery_details").insert({
      request_id: request.id,
      delivery_location: formData.get("delivery_location") as string,
      requested_date: (formData.get("delivery_requested_date") as string) || null,
      requested_time: (formData.get("delivery_requested_time") as string) || null,
      files: permit ? [permit] : [],
    });

    const names = formData.getAll("delivery_item_name[]") as string[];
    const qtys = formData.getAll("delivery_item_qty[]") as string[];
    const images = formData.getAll("delivery_item_image[]") as File[];
    const locations = formData.getAll("delivery_item_location[]") as string[];

    const itemRows = [];
    for (let i = 0; i < names.length; i++) {
      const itemName = (names[i] || "").trim();
      const location = (locations[i] || "").trim();
      const qtyRaw = qtys[i];
      if (!itemName && !location && !qtyRaw) continue; // skip fully-empty rows

      const image = images[i] ? await uploadOne(supabase, `delivery/${request.id}/items`, images[i]) : null;

      itemRows.push({
        request_id: request.id,
        item_no: i + 1,
        item_name: itemName || `Item ${i + 1}`,
        required_quantity: parseFloat(qtyRaw || "0") || 0,
        image_url: image?.url ?? null,
        current_location: location || null,
      });
    }

    if (itemRows.length > 0) {
      await supabase.from("delivery_items").insert(itemRows);
    }
  }

  if (category === "maintenance") {
    const photoFiles = (formData.getAll("maintenance_photos") as File[])
      .filter((f) => f && f.size > 0)
      .slice(0, 6);
    const photos = await uploadMany(supabase, `maintenance/${request.id}`, photoFiles);

    const permitFile = formData.get("maintenance_work_permit") as File | null;
    const permit = permitFile
      ? await uploadOne(supabase, `maintenance/${request.id}`, permitFile)
      : null;

    await supabase.from("maintenance_details").insert({
      request_id: request.id,
      location_area: formData.get("location_area") as string,
      maintenance_type: (formData.get("maintenance_type") as string) || null,
      urgency: (formData.get("urgency") as string) || "medium",
      scheduled_date: (formData.get("maintenance_date") as string) || null,
      scheduled_time: (formData.get("maintenance_time") as string) || null,
      photos,
      work_permit: permit ? [permit] : [],
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
    const descriptions = formData.getAll("proc_desc[]") as string[];
    const quantities = formData.getAll("proc_qty[]") as string[];
    const costs = formData.getAll("proc_cost[]") as string[];
    const purchasingCategory = formData.get("purchasing_category") as string;
    const vendor = formData.get("vendor") as string;

    const rows = descriptions
      .map((desc, i) => ({
        request_id: request.id,
        item_description: desc,
        quantity: parseInt(quantities[i] || "1", 10),
        unit_cost: parseFloat(costs[i] || "0"),
        purchasing_category: purchasingCategory || null,
        vendor: vendor || null,
      }))
      .filter((r) => r.item_description);

    if (rows.length > 0) {
      await supabase.from("procurement_line_items").insert(rows);
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
