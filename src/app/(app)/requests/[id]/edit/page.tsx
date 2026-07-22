import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import RequestForm, { type RequestFormInitialData } from "../../new/RequestForm";
import { getActiveProjects } from "@/lib/cachedLookups";
import type { Category } from "@/lib/types";

export default async function EditRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: request } = await supabase.from("requests").select("*").eq("id", id).single();

  if (!request) notFound();

  const isOwner = request.requestor_id === profile.id;

  // Editing is only ever the rectify-and-resubmit path: the original
  // requestor, only while the request is sitting in "Returned for Info".
  if (!isOwner || request.status !== "returned_for_info") {
    redirect(
      `/requests/${id}?error=${encodeURIComponent("This request can't be edited right now.")}`
    );
  }

  // Surface the manager's most recent rejection reason so the requester
  // knows what to fix before resubmitting.
  const { data: comments } = await supabase
    .from("comments")
    .select("comment, posted_at")
    .eq("request_id", id)
    .order("posted_at", { ascending: false })
    .limit(10);
  const reasonComment = (comments ?? []).find((c) =>
    c.comment?.startsWith("Returned for info:")
  );

  // The request's linked project, fetched even if it's since been
  // soft-deleted -- RequestForm needs to know that to render it as an
  // "(unavailable)" option instead of silently dropping the selection.
  let currentProject: { id: string; name: string; deleted_at: string | null } | null = null;
  if (request.project_id) {
    const { data: proj } = await supabase
      .from("projects")
      .select("id, name, deleted_at")
      .eq("id", request.project_id)
      .maybeSingle();
    currentProject = proj ?? null;
  }
  const projects = await getActiveProjects();

  let initial: RequestFormInitialData = {
    title: request.title,
    priority: request.priority,
    project: request.project,
    project_id: request.project_id,
    department: request.department,
    date_required: request.date_required,
    conclude_date: request.conclude_date,
    description: request.description,
    special_instructions: request.special_instructions,
  };

  if (request.category === "maintenance") {
    const { data: details } = await supabase
      .from("maintenance_details")
      .select("*")
      .eq("request_id", id)
      .maybeSingle();
    if (details) {
      initial = {
        ...initial,
        location_area: details.location_area,
        maintenance_type: details.maintenance_type,
        urgency: details.urgency,
        maintenance_date: details.scheduled_date,
        maintenance_time: details.scheduled_time,
        maintenance_photos: details.photos ?? [],
        maintenance_work_permit: details.work_permit ?? [],
      };
    }
  } else if (request.category === "delivery") {
    const [{ data: details }, { data: items }] = await Promise.all([
      supabase.from("delivery_details").select("*").eq("request_id", id).maybeSingle(),
      supabase
        .from("delivery_items")
        .select("*")
        .eq("request_id", id)
        .order("item_no", { ascending: true }),
    ]);
    if (details) {
      initial = {
        ...initial,
        delivery_location: details.delivery_location,
        delivery_requested_date: details.requested_date,
        delivery_requested_time: details.requested_time,
        delivery_permit: details.files ?? [],
      };
    }
    initial.delivery_items = (items ?? []).map((it) => ({
      item_name: it.item_name,
      required_quantity: it.required_quantity,
      image_url: it.image_url,
      current_location: it.current_location,
    }));
  } else if (request.category === "procurement") {
    const [{ data: details }, { data: items }] = await Promise.all([
      supabase.from("procurement_details").select("*").eq("request_id", id).maybeSingle(),
      supabase
        .from("procurement_line_items")
        .select("*")
        .eq("request_id", id)
        .order("item_no", { ascending: true }),
    ]);
    if (details) {
      initial = {
        ...initial,
        purchasing_category: details.purchasing_category,
        purchasing_category_other: details.purchasing_category_other,
        vendor: details.vendor,
        procurement_needed_by: details.needed_by_date,
      };
    }
    initial.procurement_items = (items ?? []).map((it) => ({
      item_description: it.item_description,
      quantity: it.quantity,
      image_url: it.image_url,
      purchasing_link: it.purchasing_link,
    }));
  } else if (request.category === "labor") {
    const { data: lines } = await supabase
      .from("labor_personnel_lines")
      .select("*")
      .eq("request_id", id);
    initial.labor_date_from = lines?.[0]?.date_from ?? null;
    initial.labor_date_to = lines?.[0]?.date_to ?? null;
    initial.labor_lines = (lines ?? []).map((l) => ({
      personnel_type: l.personnel_type,
      quantity: l.quantity,
      nature_of_work: l.nature_of_work,
    }));
  }

  return (
    <div className="p-8">
      <div className="mb-6 max-w-2xl">
        <p className="text-xs text-slate-500 mb-1">{request.request_number}</p>
        <h1 className="text-xl font-semibold text-slate-900">Edit &amp; resubmit request</h1>
        <p className="text-sm text-slate-500 mt-1">
          This request was returned for info. Update the details below and resubmit — it goes
          back into the approval queue under the same request number.
        </p>
        {reasonComment && (
          <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 text-orange-800 text-sm px-4 py-3">
            <span className="font-medium">Reason: </span>
            {reasonComment.comment.replace(/^Returned for info:\s*/, "")}
          </div>
        )}
      </div>
      <RequestForm
        mode="edit"
        requestId={id}
        category={request.category as Category}
        initial={initial}
        projects={projects}
        currentProject={currentProject}
      />
    </div>
  );
}
