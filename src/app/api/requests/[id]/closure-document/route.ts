import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { format, parseISO } from "date-fns";
import {
  renderClosureDocument,
  fetchEmbeddableImage,
  type ClosureDocConfig,
  type CostLine,
  type FetchedImage,
  type SignOff,
} from "@/lib/pdf/closureDocument";
import {
  LABOR_TYPES,
  NATURE_OF_WORK_OPTIONS,
  PURCHASING_CATEGORIES,
  COST_CATEGORY_LABELS,
  SIGNED_BY_ROLE_LABELS,
} from "@/lib/types";

// The PDF "closure record" -- unlike the four .docx generators (which stay
// exactly as they are, available on demand at any status for internal
// working use) this is a single, read-only proof-of-completion document
// that only exists once a request is closed: it bakes in the technician's
// captured signature and after-completion photos plus the final cost
// breakdown, none of which the .docx versions know about. Same audience as
// the .docx links -- coordinators, warehouse staff, managers -- not the
// original requester.
function canDownloadClosureDocument(profile: { is_manager?: boolean; role: string }) {
  return (
    profile.is_manager ||
    profile.role === "logistics_coordinator" ||
    profile.role === "warehouse_team"
  );
}

function personnelTypeLabel(value: string | null) {
  if (!value) return "—";
  return LABOR_TYPES.find((t) => t.value === value)?.label ?? value;
}

function natureOfWorkLabel(value: string | null) {
  if (!value) return "—";
  return NATURE_OF_WORK_OPTIONS.find((n) => n.value === value)?.label ?? value;
}

function purchasingCategoryLabel(value: string | null) {
  if (!value) return "—";
  return PURCHASING_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const profile = await getProfile();

  if (!canDownloadClosureDocument(profile)) {
    return NextResponse.json(
      { error: "You don't have permission to download closure documents." },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select(
      "*, requestor:profiles!requests_requestor_id_fkey(full_name), approver:profiles!requests_approved_by_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name), assigned_technician:profiles!requests_assigned_technician_id_fkey(full_name), linked_project:projects!requests_project_id_fkey(name, deleted_at)"
    )
    .eq("id", id)
    .single();

  if (!request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (request.status !== "closed") {
    return NextResponse.json(
      { error: "The closure document is available once this request is closed." },
      { status: 400 }
    );
  }

  const [{ data: closeout }, { data: costLineRows }] = await Promise.all([
    supabase.from("request_closeouts").select("*").eq("request_id", id).maybeSingle(),
    supabase
      .from("request_cost_lines")
      .select("*")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const costLines: CostLine[] = (costLineRows ?? []).map((l) => ({
    category: COST_CATEGORY_LABELS[l.cost_category] ?? l.cost_category,
    description: l.description ?? "",
    amount: Number(l.amount) || 0,
  }));

  const photoFiles: { name: string; url: string }[] = closeout?.technician_photos ?? [];
  const photos: FetchedImage[] = (
    await Promise.all(photoFiles.map((p) => fetchEmbeddableImage(p.url)))
  ).filter((p): p is FetchedImage => p !== null);

  let signOff: SignOff | null = null;
  if (closeout?.signature_url) {
    const signature = await fetchEmbeddableImage(closeout.signature_url);
    signOff = {
      signature,
      signedByName: closeout.signed_by_name ?? "—",
      signedByRole: SIGNED_BY_ROLE_LABELS[closeout.signed_by_role ?? ""] ?? "—",
      signedAt: closeout.signed_at
        ? format(parseISO(closeout.signed_at), "MMM d, yyyy, h:mm a")
        : "—",
    };
  }

  const requestorName = (request.requestor as { full_name?: string } | null)?.full_name ?? "—";
  const approverName = (request.approver as { full_name?: string } | null)?.full_name ?? "—";
  const ownerName = (request.owner as { full_name?: string } | null)?.full_name ?? "—";
  const technicianName =
    (request.assigned_technician as { full_name?: string } | null)?.full_name ?? null;
  // The technician who was on site is the more useful "assigned to" for a
  // closure record than the coordinator who owns the request paperwork --
  // falls back to the coordinator when no technician was ever assigned
  // (the feature is optional; older closed requests won't have one).
  const assignedTo = technicianName ?? ownerName;

  const linkedProject = request.linked_project as
    | { name: string; deleted_at: string | null }
    | null;
  const projectDisplay = linkedProject
    ? linkedProject.deleted_at
      ? "Unavailable Project"
      : linkedProject.name
    : request.project ?? "—";

  const generatedDate = format(new Date(), "MMM d, yyyy");

  let config: ClosureDocConfig;

  if (request.category === "delivery") {
    const [{ data: deliveryDetails }, { data: items }] = await Promise.all([
      supabase.from("delivery_details").select("*").eq("request_id", id).maybeSingle(),
      supabase
        .from("delivery_items")
        .select("*")
        .eq("request_id", id)
        .order("item_no", { ascending: true }),
    ]);
    config = {
      docTypeLabel: "Delivery note",
      docNumberLabel: "Delivery note no.",
      docNumber: request.request_number ?? "—",
      generatedDate,
      fields: [
        { label: "Requested by", value: requestorName },
        { label: "Deliver to", value: projectDisplay },
        { label: "Department", value: request.department ?? "—" },
        { label: "Delivery address", value: deliveryDetails?.delivery_location ?? "—" },
        { label: "Project", value: projectDisplay },
        { label: "Assigned to", value: assignedTo },
        { label: "Approved by", value: approverName },
      ],
      table: {
        headers: ["S/N", "Item", "Qty", "Location"],
        colWidths: [0.1, 0.5, 0.15, 0.25],
        rows: (items ?? []).map((it) => [
          String(it.item_no),
          it.item_name,
          String(it.required_quantity),
          it.current_location || "—",
        ]),
      },
      costLines,
      photos,
      signOff,
      closingNote:
        "This is to confirm that the above items have been delivered and received in good condition, unless otherwise noted above.",
    };
  } else if (request.category === "maintenance") {
    const { data: maintenanceDetails } = await supabase
      .from("maintenance_details")
      .select("*")
      .eq("request_id", id)
      .maybeSingle();
    const scheduled = maintenanceDetails?.scheduled_date
      ? `${format(parseISO(maintenanceDetails.scheduled_date), "MMM d, yyyy")}${
          maintenanceDetails.scheduled_time ? ` · ${maintenanceDetails.scheduled_time}` : ""
        }`
      : "—";
    config = {
      docTypeLabel: "Maintenance report",
      docNumberLabel: "Report no.",
      docNumber: request.request_number ?? "—",
      generatedDate,
      fields: [
        { label: "Requested by", value: requestorName },
        { label: "Location / area", value: maintenanceDetails?.location_area ?? "—" },
        { label: "Department", value: request.department ?? "—" },
        { label: "Type of maintenance", value: maintenanceDetails?.maintenance_type ?? "—" },
        { label: "Project", value: projectDisplay },
        { label: "Urgency", value: maintenanceDetails?.urgency ?? "—" },
        { label: "Assigned to", value: assignedTo },
        { label: "Scheduled", value: scheduled },
        { label: "Approved by", value: approverName },
      ],
      costLines,
      photos,
      signOff,
      closingNote:
        "This is to confirm that the above maintenance work has been carried out and inspected, unless otherwise noted above.",
    };
  } else if (request.category === "labor") {
    const { data: lines } = await supabase
      .from("labor_personnel_lines")
      .select("*")
      .eq("request_id", id);
    config = {
      docTypeLabel: "Labor deployment sheet",
      docNumberLabel: "Request no.",
      docNumber: request.request_number ?? "—",
      generatedDate,
      fields: [
        { label: "Requested by", value: requestorName },
        {
          label: "Date required",
          value: request.date_required
            ? format(parseISO(request.date_required), "MMM d, yyyy")
            : "—",
        },
        { label: "Department", value: request.department ?? "—" },
        {
          label: "Conclude by",
          value: request.conclude_date
            ? format(parseISO(request.conclude_date), "MMM d, yyyy")
            : "—",
        },
        { label: "Project", value: projectDisplay },
        { label: "Assigned to", value: assignedTo },
        { label: "Approved by", value: approverName },
      ],
      table: {
        headers: ["Type of labor", "Qty", "From", "To", "Nature of work"],
        colWidths: [0.28, 0.1, 0.18, 0.18, 0.26],
        rows: (lines ?? []).map((l) => [
          personnelTypeLabel(l.personnel_type),
          String(l.quantity),
          l.date_from ? format(parseISO(l.date_from), "MMM d") : "—",
          l.date_to ? format(parseISO(l.date_to), "MMM d") : "—",
          natureOfWorkLabel(l.nature_of_work),
        ]),
      },
      costLines,
      photos,
      signOff,
      closingNote:
        "This is to confirm that the above labor deployment has been completed as described, unless otherwise noted above.",
    };
  } else if (request.category === "procurement") {
    const [{ data: procurementDetails }, { data: items }] = await Promise.all([
      supabase.from("procurement_details").select("*").eq("request_id", id).maybeSingle(),
      supabase
        .from("procurement_line_items")
        .select("*")
        .eq("request_id", id)
        .order("item_no", { ascending: true }),
    ]);
    const purchasingCategory =
      procurementDetails?.purchasing_category === "other"
        ? procurementDetails.purchasing_category_other || "Other"
        : purchasingCategoryLabel(procurementDetails?.purchasing_category ?? null);
    config = {
      docTypeLabel: "Purchase requisition",
      docNumberLabel: "PR no.",
      docNumber: request.request_number ?? "—",
      generatedDate,
      fields: [
        { label: "Requested by", value: requestorName },
        { label: "Purchasing category", value: purchasingCategory },
        { label: "Department", value: request.department ?? "—" },
        { label: "Vendor", value: procurementDetails?.vendor ?? "—" },
        { label: "Project", value: projectDisplay },
        {
          label: "Needed by",
          value: procurementDetails?.needed_by_date
            ? format(parseISO(procurementDetails.needed_by_date), "MMM d, yyyy")
            : "—",
        },
        { label: "Assigned to", value: assignedTo },
        { label: "Approved by", value: approverName },
      ],
      table: {
        headers: ["S/N", "Item", "Qty", "Purchasing link"],
        colWidths: [0.1, 0.5, 0.15, 0.25],
        rows: (items ?? []).map((it) => [
          String(it.item_no),
          it.item_description ?? "—",
          String(it.quantity),
          it.purchasing_link || "—",
        ]),
      },
      costLines,
      photos,
      signOff,
      closingNote:
        "This is to confirm that the above items have been procured and received, unless otherwise noted above.",
    };
  } else {
    return NextResponse.json({ error: "Unsupported request category." }, { status: 400 });
  }

  const buffer = await renderClosureDocument(config);
  const fileName = `Closure-Document-${request.request_number ?? id}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
