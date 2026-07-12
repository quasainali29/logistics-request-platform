"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function createRequest(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const category = formData.get("category") as string;

  const { data: request, error } = await supabase
    .from("requests")
    .insert({
      title: formData.get("title") as string,
      category,
      requestor_id: user.id,
      project_id: (formData.get("project_id") as string) || null,
      department: (formData.get("department") as string) || null,
      priority: (formData.get("priority") as string) || "medium",
      date_required: (formData.get("date_required") as string) || null,
      description: (formData.get("description") as string) || null,
      special_instructions: (formData.get("special_instructions") as string) || null,
    })
    .select()
    .single();

  if (error || !request) {
    redirect(`/requests/new?error=${encodeURIComponent(error?.message ?? "Could not create request")}`);
  }

  if (category === "delivery") {
    await supabase.from("delivery_details").insert({
      request_id: request.id,
      delivery_location: formData.get("delivery_location") as string,
      requested_date: (formData.get("delivery_requested_date") as string) || null,
    });
  }

  if (category === "maintenance") {
    await supabase.from("maintenance_details").insert({
      request_id: request.id,
      location_area: formData.get("location_area") as string,
      issue_category: formData.get("issue_category") as string,
      urgency: (formData.get("urgency") as string) || "medium",
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
