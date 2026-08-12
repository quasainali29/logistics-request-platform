import type { ReactNode } from "react";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatStatusLabel,
  statusColor,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
  PURCHASING_CATEGORIES,
  LABOR_TYPES,
  NATURE_OF_WORK_OPTIONS,
  type Priority,
  type Category,
  type WorkflowStage,
  type WorkflowTransition,
  type DeliveryDetails,
  type DeliveryItem,
  type MaintenanceDetails,
  type ProcurementDetails,
  type ProcurementItem,
  type LaborLine,
  type RequestCloseout,
  type LaborCloseoutLine,
  type RequestCostLine,
  SIGNED_BY_ROLE_LABELS,
} from "@/lib/types";
import { getWorkflowStages } from "@/lib/cachedLookups";
import { can } from "@/lib/permissions";
import {
  StatusButton,
  CommentBox,
  ApproveRejectControls,
  AssignTechniciansControl,
  ManageTechniciansControl,
  AcceptJobControl,
  ReassignCoordinatorControl,
  UnassignCoordinatorControl,
} from "./actions-client";
import { CloseoutForm } from "./CloseoutForm";
import { CostBreakdownManager } from "./CostBreakdownManager";
import { format, parseISO } from "date-fns";
import { notFound } from "next/navigation";
import Link from "next/link";

function purchasingCategoryLabel(value: string | null) {
  if (!value) return "—";
  return PURCHASING_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function personnelTypeLabel(value: string | null) {
  if (!value) return "—";
  return LABOR_TYPES.find((t) => t.value === value)?.label ?? value;
}

function natureOfWorkLabel(value: string | null) {
  if (!value) return "—";
  return NATURE_OF_WORK_OPTIONS.find((n) => n.value === value)?.label ?? value;
}

// Highlights @mentions in posted comment text. Matches full names sorted
// longest-first so a short name can't shadow a longer one that shares a
// prefix (e.g. "Bilal" vs "Bilal Ahmed").
function renderCommentText(
  text: string,
  users: { id: string; full_name: string }[]
) {
  const names = users
    .map((u) => u.full_name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (names.length === 0) return text;

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(${escaped.join("|")})`, "g");

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <span key={match.index} className="text-[var(--accent)] font-medium">
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select(
      "*, requestor:profiles!requests_requestor_id_fkey(full_name, email), approver:profiles!requests_approved_by_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name), linked_project:projects!requests_project_id_fkey(name, deleted_at)"
    )
    .eq("id", id)
    .single();

  if (!request) notFound();

  // A soft-deleted project still resolves here (the FK link is untouched)
  // -- we just swap the display label so it doesn't show a name that no
  // longer exists in the admin's Projects list.
  const linkedProject = request.linked_project as { name: string; deleted_at: string | null } | null;
  const projectDisplay = linkedProject
    ? linkedProject.deleted_at
      ? "Unavailable Project"
      : linkedProject.name
    : request.project ?? "—";

  const [
    { data: comments },
    { data: history },
    allStages,
    { data: transitions },
    { data: closeout },
    { data: laborCloseoutLines },
    { data: costLines },
  ] = await Promise.all([
    supabase
      .from("comments")
      .select("*, author:profiles(full_name)")
      .eq("request_id", id)
      .order("posted_at", { ascending: true }),
    supabase
      .from("status_history")
      .select("*, changed_by_profile:profiles(full_name)")
      .eq("request_id", id)
      .order("changed_at", { ascending: false }),
    getWorkflowStages(),
    supabase
      .from("workflow_transitions")
      .select("*")
      .eq("category", request.category)
      .eq("from_key", request.status)
      .order("sort_order", { ascending: true }),
    supabase.from("request_closeouts").select("*").eq("request_id", id).maybeSingle(),
    supabase.from("labor_closeout_lines").select("*").eq("request_id", id),
    supabase
      .from("request_cost_lines")
      .select("*")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
  ]);

  // workflow_stages is cached across all categories; narrow to this
  // request's category here instead of filtering it in the query itself.
  const stages = allStages.filter((s) => s.category === request.category);

  // Coordinators for the Approve → Assign dropdown (managers reviewing a
  // request still waiting on the approval gate) and for the Reassign
  // Coordinator dropdown (managers changing the owner of an already-owned,
  // still-active request) -- same options list, two different entry points.
  const currentStageForOwner = stages.find((s) => s.key === request.status);
  const canManageCoordinatorAssignment =
    !!profile.is_manager && !!request.owner_id && !currentStageForOwner?.is_terminal;
  let coordinators: { id: string; full_name: string }[] = [];
  if (
    (profile.is_manager && request.status === "submitted") ||
    canManageCoordinatorAssignment
  ) {
    const { data: coords } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "logistics_coordinator")
      .eq("status", "active")
      .order("full_name", { ascending: true });
    coordinators = coords ?? [];
  }

  // The @mention picker in Comments lists every active account across all
  // roles and departments — intentionally not scoped to logistics staff.
  const { data: mentionableProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("status", "active")
    .order("full_name", { ascending: true });
  const commentUsers = mentionableProfiles ?? [];

  // Pre-populate the labor closeout's "Personnel deployed" table from the
  // original request's personnel lines the first time the coordinator
  // opens the closeout form.
  let laborSeedLines: { personnel_type: string; quantity: number }[] = [];
  if (request.category === "labor" && request.status === "completed") {
    if (laborCloseoutLines && laborCloseoutLines.length > 0) {
      laborSeedLines = (laborCloseoutLines as LaborCloseoutLine[]).map((l) => ({
        personnel_type: l.personnel_type,
        quantity: l.quantity,
      }));
    } else {
      const { data: originalLines } = await supabase
        .from("labor_personnel_lines")
        .select("personnel_type, quantity")
        .eq("request_id", id);
      laborSeedLines = (originalLines ?? []).map((l) => ({
        personnel_type: l.personnel_type,
        quantity: l.quantity,
      }));
    }
  }

  let deliveryDetails: DeliveryDetails | null = null;
  let deliveryItems: DeliveryItem[] = [];
  let maintenanceDetails: MaintenanceDetails | null = null;
  let procurementDetails: ProcurementDetails | null = null;
  let procurementItems: ProcurementItem[] = [];
  let laborLines: LaborLine[] = [];

  if (request.category === "delivery") {
    const [{ data: dd }, { data: items }] = await Promise.all([
      supabase.from("delivery_details").select("*").eq("request_id", id).maybeSingle(),
      supabase
        .from("delivery_items")
        .select("*")
        .eq("request_id", id)
        .order("item_no", { ascending: true }),
    ]);
    deliveryDetails = dd as DeliveryDetails | null;
    deliveryItems = (items ?? []) as DeliveryItem[];
  } else if (request.category === "labor") {
    const { data } = await supabase
      .from("labor_personnel_lines")
      .select("*")
      .eq("request_id", id);
    laborLines = (data ?? []) as LaborLine[];
  } else if (request.category === "maintenance") {
    const { data } = await supabase
      .from("maintenance_details")
      .select("*")
      .eq("request_id", id)
      .maybeSingle();
    maintenanceDetails = data as MaintenanceDetails | null;
  } else if (request.category === "procurement") {
    const [{ data: pd }, { data: items }] = await Promise.all([
      supabase.from("procurement_details").select("*").eq("request_id", id).maybeSingle(),
      supabase
        .from("procurement_line_items")
        .select("*")
        .eq("request_id", id)
        .order("item_no", { ascending: true }),
    ]);
    procurementDetails = pd as ProcurementDetails | null;
    procurementItems = (items ?? []) as ProcurementItem[];
  }

  const stageList = (stages ?? []) as WorkflowStage[];
  const availableTransitions = (transitions ?? []) as WorkflowTransition[];
  const isOwner = request.requestor_id === profile.id;

  const status = request.status as string;

  // A transition shows up if the current user's role is explicitly allowed,
  // or they're a manager (managers can always act — same rule the server
  // action enforces in requests/actions.ts). The generic "submitted ->
  // under_review" hop is superseded by the Approve/Reject + assign flow
  // below, and "completed -> closed" is superseded by the closeout form —
  // both are filtered out here so the old buttons don't show alongside the
  // new UI.
  const visibleTransitions = availableTransitions.filter((t) => {
    if (status === "submitted" && t.to_key === "under_review") return false;
    if (status === "completed" && t.to_key === "closed") return false;
    if (t.from_key === "on_site" && t.to_key === "completed") return false;
    // Superseded by AcceptJobControl below -- accepting is now per-crew-
    // member and the request only advances once everyone's accepted,
    // which the old single generic transition button can't express.
    if (t.from_key === "assigned" && t.to_key === "dispatched") return false;
    return profile.is_manager || t.allowed_roles.includes(profile.role);
  });

  const closeoutRow = closeout as RequestCloseout | null;
  const canManageCloseout = profile.is_manager || profile.role === "logistics_coordinator";
  // Delivery notes and maintenance reports are generated for whoever is
  // actually fulfilling the request, not the original requester —
  // available on any request regardless of status, since it always
  // reflects current data.
  const canGenerateFulfillmentDocs =
    profile.is_manager ||
    profile.role === "logistics_coordinator" ||
    profile.role === "warehouse_team";

  // Managers/coordinators can correct an active request's details (e.g.
  // push the due date back) any time it hasn't reached a terminal stage
  // for its category. Suppressed when the owner's own "Edit & Resubmit"
  // link is already showing below, so there aren't two buttons pointing
  // at the same /edit route.
  const currentStage = stageList.find((s) => s.key === status);
  const canManagerEditRequest =
    (profile.is_manager || profile.role === "logistics_coordinator") &&
    !currentStage?.is_terminal &&
    !(isOwner && status === "returned_for_info");

  // A crew can be assigned once the request is under a coordinator's care,
  // and managed (add/remove individual technicians) any time after that up
  // until the category's terminal stage -- same window as
  // canManagerEditRequest's "still active" check, so the buttons
  // appear/disappear together.
  const canManageAssignment =
    can(profile, "assign_technician") &&
    status !== "submitted" &&
    !currentStage?.is_terminal &&
    status !== "completed";

  let technicians: { id: string; full_name: string }[] = [];
  if (canManageAssignment) {
    const { data: techs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "technician")
      .eq("status", "active")
      .order("full_name", { ascending: true });
    technicians = techs ?? [];
  }

  // The crew currently on this request -- who's assigned, and who's
  // accepted so far. Replaces the old single assigned_technician_id/
  // assigned_technician join now that a job can have more than one
  // technician (see migration 020).
  const { data: crewRows } = await supabase
    .from("request_technicians")
    .select("technician_id, accepted_at, technician:profiles!request_technicians_technician_id_fkey(full_name)")
    .eq("request_id", id)
    .order("assigned_at", { ascending: true });

  const crew = (crewRows ?? []).map((c) => ({
    technician_id: c.technician_id as string,
    accepted_at: c.accepted_at as string | null,
    full_name: (c.technician as { full_name?: string } | null)?.full_name ?? "Unknown",
  }));

  const hasTechnician = crew.length > 0;
  const canAssignTechnicians = canManageAssignment && !hasTechnician;
  const canManageCrew = canManageAssignment && hasTechnician;
  const availableTechnicians = technicians.filter(
    (t) => !crew.some((c) => c.technician_id === t.id)
  );

  const myCrewRow = crew.find((c) => c.technician_id === profile.id);
  const isAssignedTechnician = !!myCrewRow;
  const canAcceptJob = !!myCrewRow && !myCrewRow.accepted_at && status === "assigned";

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <p className="text-xs text-slate-500 mb-1">{request.request_number}</p>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{request.title}</h1>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${statusColor(
              request.category,
              status,
              stageList
            )}`}
          >
            {formatStatusLabel(request.category, status, stageList)}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              PRIORITY_COLORS[request.priority as Priority]
            }`}
          >
            {request.priority}
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          {CATEGORY_LABELS[request.category as Category]} · Submitted by{" "}
          {request.requestor?.full_name} on{" "}
          {format(parseISO(request.created_at), "MMM d, yyyy")}
        </p>
        {crew.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm text-slate-500">Technicians:</span>
            {crew.map((c) => (
              <span key={c.technician_id} className="flex items-center gap-1.5 text-sm text-slate-700">
                {c.full_name}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    c.accepted_at
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {c.accepted_at ? "Accepted" : "Pending"}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action bar — driven by the admin-configured workflow for this category */}
      <div className="flex flex-wrap gap-2 mb-8">
        {status === "submitted" && profile.is_manager && (
          <ApproveRejectControls
            requestId={id}
            coordinators={coordinators}
            category={request.category}
          />
        )}
        {canAssignTechnicians && (
          <AssignTechniciansControl requestId={id} technicians={technicians} />
        )}
        {canAcceptJob && <AcceptJobControl requestId={id} />}
        {visibleTransitions.map((t) => (
          <StatusButton
            key={t.id}
            requestId={id}
            status={t.to_key}
            label={t.label}
            variant={t.variant}
          />
        ))}
        {isAssignedTechnician && status === "on_site" && (
          <Link
            href={`/requests/${id}/complete`}
            className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition"
          >
            Mark Completed
          </Link>
        )}
        {isOwner && status === "returned_for_info" && (
          <Link
            href={`/requests/${id}/edit`}
            className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition"
          >
            Edit &amp; Resubmit
          </Link>
        )}
        {canManageCrew && (
          <ManageTechniciansControl
            requestId={id}
            crew={crew}
            availableTechnicians={availableTechnicians}
          />
        )}
        {canManageCoordinatorAssignment && (
          <ReassignCoordinatorControl
            requestId={id}
            coordinators={coordinators}
            currentCoordinatorName={request.owner?.full_name ?? null}
          />
        )}
        {canManageCoordinatorAssignment && (
          <UnassignCoordinatorControl
            requestId={id}
            currentCoordinatorName={request.owner?.full_name ?? null}
          />
        )}
        {canManagerEditRequest && (
          <Link
            href={`/requests/${id}/edit`}
            className="rounded-md px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
          >
            Edit Request
          </Link>
        )}
      </div>

      {closeoutRow?.signature_url && (
        <section className="mb-8 bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Job completion</h2>
          <div className="grid md:grid-cols-2 gap-7">
            <div>
              {closeoutRow.technician_notes && (
                <>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">
                    Notes
                  </h3>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap mb-5">
                    {closeoutRow.technician_notes}
                  </p>
                </>
              )}
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">
                Signature
              </h3>
              <div className="border border-slate-200 rounded-lg p-3 inline-block bg-slate-50 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={closeoutRow.signature_url} alt="Signature" className="h-20" />
              </div>
              <p className="text-xs text-slate-500">
                Signed by {closeoutRow.signed_by_name}
                {closeoutRow.signed_by_role &&
                  ` (${SIGNED_BY_ROLE_LABELS[closeoutRow.signed_by_role] ?? closeoutRow.signed_by_role})`}
                {closeoutRow.signed_at &&
                  ` · ${format(parseISO(closeoutRow.signed_at), "MMM d, yyyy 'at' h:mm a")}`}
              </p>
            </div>

            {closeoutRow.technician_photos?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">
                  Photos
                </h3>
                <div className="grid grid-cols-3 gap-2.5">
                  {closeoutRow.technician_photos.map((p, i) => (
                    <a
                      key={i}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-square rounded-lg overflow-hidden border border-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {status === "completed" && canManageCloseout && (
        <div className="mb-8">
          <CloseoutForm
            requestId={id}
            category={request.category}
            laborLines={request.category === "labor" ? laborSeedLines : undefined}
          />
        </div>
      )}

      {status === "closed" && (
        <div className="mb-8">
          <CostBreakdownManager
            requestId={id}
            lines={(costLines ?? []) as RequestCostLine[]}
            canEdit={!!profile.is_manager}
          />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Description</h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {request.description || "—"}
            </p>
            {request.special_instructions && (
              <>
                <h3 className="text-xs font-semibold text-slate-500 mt-4 mb-1 uppercase">
                  Special instructions
                </h3>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {request.special_instructions}
                </p>
              </>
            )}
          </section>

          {request.category === "maintenance" && maintenanceDetails && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Maintenance details</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  {canGenerateFulfillmentDocs && (
                    <a
                      href={`/api/requests/${id}/maintenance-report`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Generate maintenance form
                    </a>
                  )}
                  {canGenerateFulfillmentDocs && status === "closed" && (
                    <a
                      href={`/api/requests/${id}/closure-document`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Download closure document (PDF)
                    </a>
                  )}
                </div>
              </div>
              <dl className="space-y-2 text-sm mb-4">
                <Row label="Location / area" value={maintenanceDetails.location_area ?? "—"} />
                <Row
                  label="Type of maintenance"
                  value={maintenanceDetails.maintenance_type ?? "—"}
                />
                <Row label="Urgency" value={maintenanceDetails.urgency ?? "—"} />
                <Row
                  label="Scheduled"
                  value={
                    maintenanceDetails.scheduled_date
                      ? `${format(parseISO(maintenanceDetails.scheduled_date), "MMM d, yyyy")}${
                          maintenanceDetails.scheduled_time
                            ? ` · ${maintenanceDetails.scheduled_time}`
                            : ""
                        }`
                      : "—"
                  }
                />
              </dl>

              {maintenanceDetails.photos?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase">
                    Photos
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {maintenanceDetails.photos.map((p, i) => (
                      <a
                        key={i}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-20 h-20 rounded-md overflow-hidden border border-slate-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {maintenanceDetails.work_permit?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-1 uppercase">
                    Work permit
                  </h3>
                  {maintenanceDetails.work_permit.map((f, i) => (
                    <a
                      key={i}
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--accent)] underline block"
                    >
                      {f.name}
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}

          {request.category === "delivery" && deliveryDetails && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Delivery details</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  {canGenerateFulfillmentDocs && (
                    <a
                      href={`/api/requests/${id}/delivery-note`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Generate delivery note
                    </a>
                  )}
                  {canGenerateFulfillmentDocs && status === "closed" && (
                    <a
                      href={`/api/requests/${id}/closure-document`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Download closure document (PDF)
                    </a>
                  )}
                </div>
              </div>
              <dl className="space-y-2 text-sm mb-4">
                <Row label="Delivery location" value={deliveryDetails.delivery_location ?? "—"} />
                <Row
                  label="Requested"
                  value={
                    deliveryDetails.requested_date
                      ? `${format(parseISO(deliveryDetails.requested_date), "MMM d, yyyy")}${
                          deliveryDetails.requested_time
                            ? ` · ${deliveryDetails.requested_time}`
                            : ""
                        }`
                      : "—"
                  }
                />
              </dl>

              {deliveryDetails.files?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold text-slate-500 mb-1 uppercase">
                    Delivery permit
                  </h3>
                  {deliveryDetails.files.map((f, i) => (
                    <a
                      key={i}
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--accent)] underline block"
                    >
                      {f.name}
                    </a>
                  ))}
                </div>
              )}

              {deliveryItems.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase">
                    Items
                  </h3>
                  <div className="overflow-hidden border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">#</th>
                          <th className="text-left px-3 py-2 font-medium">Item</th>
                          <th className="text-left px-3 py-2 font-medium">Qty</th>
                          <th className="text-left px-3 py-2 font-medium">Image</th>
                          <th className="text-left px-3 py-2 font-medium">Location</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {deliveryItems.map((it) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 text-slate-500">{it.item_no}</td>
                            <td className="px-3 py-2 text-slate-900">{it.item_name}</td>
                            <td className="px-3 py-2 text-slate-700">{it.required_quantity}</td>
                            <td className="px-3 py-2">
                              {it.image_url ? (
                                <a href={it.image_url} target="_blank" rel="noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={it.image_url}
                                    alt={it.item_name}
                                    className="w-10 h-10 object-cover rounded"
                                  />
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {it.current_location ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {request.category === "procurement" &&
            (procurementDetails || procurementItems.length > 0) && (
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Procurement details
                  </h2>
                  <div className="flex items-center gap-3 flex-wrap">
                    {canGenerateFulfillmentDocs && (
                      <a
                        href={`/api/requests/${id}/purchase-requisition`}
                        className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                      >
                        Generate purchase requisition
                      </a>
                    )}
                    {canGenerateFulfillmentDocs && status === "closed" && (
                      <a
                        href={`/api/requests/${id}/closure-document`}
                        className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                      >
                        Download closure document (PDF)
                      </a>
                    )}
                  </div>
                </div>

                {procurementDetails && (
                  <dl className="space-y-2 text-sm mb-4">
                    <Row
                      label="Purchasing category"
                      value={
                        procurementDetails.purchasing_category === "other"
                          ? procurementDetails.purchasing_category_other || "Other"
                          : purchasingCategoryLabel(procurementDetails.purchasing_category)
                      }
                    />
                    <Row label="Vendor" value={procurementDetails.vendor ?? "—"} />
                    <Row
                      label="Needed by"
                      value={
                        procurementDetails.needed_by_date
                          ? format(parseISO(procurementDetails.needed_by_date), "MMM d, yyyy")
                          : "—"
                      }
                    />
                  </dl>
                )}

                {procurementItems.length > 0 && (
                  <div className="overflow-hidden border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">#</th>
                          <th className="text-left px-3 py-2 font-medium">Item</th>
                          <th className="text-left px-3 py-2 font-medium">Qty</th>
                          <th className="text-left px-3 py-2 font-medium">Image</th>
                          <th className="text-left px-3 py-2 font-medium">Purchasing link</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {procurementItems.map((it) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 text-slate-500">{it.item_no}</td>
                            <td className="px-3 py-2 text-slate-900">
                              {it.item_description ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{it.quantity}</td>
                            <td className="px-3 py-2">
                              {it.image_url ? (
                                <a href={it.image_url} target="_blank" rel="noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={it.image_url}
                                    alt={it.item_description ?? "Item"}
                                    className="w-10 h-10 object-cover rounded"
                                  />
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {it.purchasing_link ? (
                                <a
                                  href={it.purchasing_link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[var(--accent)] underline"
                                >
                                  View link
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

          {request.category === "labor" && laborLines.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Labor details</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  {canGenerateFulfillmentDocs && (
                    <a
                      href={`/api/requests/${id}/labor-deployment-sheet`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Generate labor deployment sheet
                    </a>
                  )}
                  {canGenerateFulfillmentDocs && status === "closed" && (
                    <a
                      href={`/api/requests/${id}/closure-document`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Download closure document (PDF)
                    </a>
                  )}
                </div>
              </div>
              <div className="overflow-hidden border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium">Qty</th>
                      <th className="text-left px-3 py-2 font-medium">From</th>
                      <th className="text-left px-3 py-2 font-medium">To</th>
                      <th className="text-left px-3 py-2 font-medium">Nature of work</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {laborLines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 text-slate-900">
                          {personnelTypeLabel(l.personnel_type)}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{l.quantity}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {l.date_from ? format(parseISO(l.date_from), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {l.date_to ? format(parseISO(l.date_to), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {natureOfWorkLabel(l.nature_of_work)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {closeoutRow && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                Closeout documents
              </h2>
              <dl className="space-y-2 text-sm mb-4">
                {closeoutRow.delivery_location && (
                  <Row label="Delivery location" value={closeoutRow.delivery_location} />
                )}
                {typeof closeoutRow.total_value === "number" && (
                  <Row
                    label="Total procurement value"
                    value={closeoutRow.total_value.toFixed(2)}
                  />
                )}
              </dl>

              <div className="flex flex-wrap gap-4">
                {closeoutRow.delivery_note && (
                  <FileLink label="Delivery note" file={closeoutRow.delivery_note} />
                )}
                {closeoutRow.labor_sheet && (
                  <FileLink label="Labor sheet" file={closeoutRow.labor_sheet} />
                )}
                {closeoutRow.maintenance_form && (
                  <FileLink label="Signed maintenance form" file={closeoutRow.maintenance_form} />
                )}
                {closeoutRow.invoice && <FileLink label="Invoice" file={closeoutRow.invoice} />}
              </div>

              {closeoutRow.maintenance_photos?.length > 0 && (
                <PhotoGrid label="Maintenance photos" photos={closeoutRow.maintenance_photos} />
              )}
              {closeoutRow.procurement_photos?.length > 0 && (
                <PhotoGrid label="Items procured" photos={closeoutRow.procurement_photos} />
              )}

              {request.category === "labor" &&
                (laborCloseoutLines as LaborCloseoutLine[] | null)?.length ? (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase">
                    Personnel deployed
                  </h3>
                  <div className="overflow-hidden border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Type of Labor</th>
                          <th className="text-left px-3 py-2 font-medium">Quantity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(laborCloseoutLines as LaborCloseoutLine[]).map((l) => (
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-slate-900">{l.personnel_type}</td>
                            <td className="px-3 py-2 text-slate-700">{l.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Comments</h2>
            <div className="space-y-3 mb-4">
              {(comments ?? []).map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium text-slate-900">
                    {c.author?.full_name}
                  </span>{" "}
                  <span className="text-slate-400 text-xs">
                    {format(parseISO(c.posted_at), "MMM d, h:mm a")}
                  </span>
                  <p className="text-slate-700">
                    {renderCommentText(c.comment, commentUsers)}
                  </p>
                </div>
              ))}
              {(comments ?? []).length === 0 && (
                <p className="text-sm text-slate-400">No comments yet.</p>
              )}
            </div>
            <CommentBox requestId={id} users={commentUsers} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Details</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Project" value={projectDisplay} />
              <Row label="Department" value={request.department ?? "—"} />
              <Row
                label="Date required"
                value={
                  request.date_required
                    ? format(parseISO(request.date_required), "MMM d, yyyy")
                    : "—"
                }
              />
              <Row
                label="Conclude by"
                value={
                  request.conclude_date
                    ? format(parseISO(request.conclude_date), "MMM d, yyyy")
                    : "—"
                }
              />
              <Row label="Approved by" value={request.approver?.full_name ?? "—"} />
              <Row label="Assigned to" value={request.owner?.full_name ?? "—"} />
            </dl>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">History</h2>
            <ol className="space-y-3">
              {(history ?? []).map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="text-slate-900">
                    {formatStatusLabel(request.category, h.status, stageList)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {h.changed_by_profile?.full_name ?? "System"} ·{" "}
                    {format(parseISO(h.changed_at), "MMM d, h:mm a")}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

function FileLink({ label, file }: { label: string; file: { name: string; url: string } }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 mb-1 uppercase">{label}</h3>
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-[var(--accent)] underline"
      >
        {file.name}
      </a>
    </div>
  );
}

function PhotoGrid({
  label,
  photos,
}: {
  label: string;
  photos: { name: string; url: string }[];
}) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block w-20 h-20 rounded-md overflow-hidden border border-slate-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
}
