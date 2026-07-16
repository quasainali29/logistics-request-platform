import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatStatusLabel,
  statusColor,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
  type Priority,
  type Category,
  type WorkflowStage,
  type WorkflowTransition,
  type DeliveryDetails,
  type DeliveryItem,
  type MaintenanceDetails,
  type RequestCloseout,
  type LaborCloseoutLine,
} from "@/lib/types";
import { StatusButton, CommentBox, ApproveRejectControls } from "./actions-client";
import { CloseoutForm } from "./CloseoutForm";
import { format, parseISO } from "date-fns";
import { notFound } from "next/navigation";

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
      "*, requestor:profiles!requests_requestor_id_fkey(full_name, email), approver:profiles!requests_approved_by_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name)"
    )
    .eq("id", id)
    .single();

  if (!request) notFound();

  const [
    { data: comments },
    { data: history },
    { data: stages },
    { data: transitions },
    { data: closeout },
    { data: laborCloseoutLines },
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
    supabase
      .from("workflow_stages")
      .select("*")
      .eq("category", request.category),
    supabase
      .from("workflow_transitions")
      .select("*")
      .eq("category", request.category)
      .eq("from_key", request.status)
      .order("sort_order", { ascending: true }),
    supabase.from("request_closeouts").select("*").eq("request_id", id).maybeSingle(),
    supabase.from("labor_closeout_lines").select("*").eq("request_id", id),
  ]);

  // Coordinators for the Approve → Assign dropdown, only fetched for
  // managers viewing a request that's still waiting on the approval gate.
  let coordinators: { id: string; full_name: string }[] = [];
  if (profile.is_manager && request.status === "submitted") {
    const { data: coords } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "logistics_coordinator")
      .eq("status", "active")
      .order("full_name", { ascending: true });
    coordinators = coords ?? [];
  }

  // Pre-populate the labor closeout cost table from the original request's
  // personnel lines the first time the coordinator opens the closeout form.
  let laborSeedLines: { personnel_type: string; quantity: number; cost_per_labor: number }[] = [];
  if (request.category === "labor" && request.status === "completed") {
    if (laborCloseoutLines && laborCloseoutLines.length > 0) {
      laborSeedLines = (laborCloseoutLines as LaborCloseoutLine[]).map((l) => ({
        personnel_type: l.personnel_type,
        quantity: l.quantity,
        cost_per_labor: l.cost_per_labor,
      }));
    } else {
      const { data: originalLines } = await supabase
        .from("labor_personnel_lines")
        .select("personnel_type, quantity")
        .eq("request_id", id);
      laborSeedLines = (originalLines ?? []).map((l) => ({
        personnel_type: l.personnel_type,
        quantity: l.quantity,
        cost_per_labor: 0,
      }));
    }
  }

  let deliveryDetails: DeliveryDetails | null = null;
  let deliveryItems: DeliveryItem[] = [];
  let maintenanceDetails: MaintenanceDetails | null = null;
  let genericDetails: Record<string, unknown>[] | null = null;

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
    genericDetails = data;
  } else if (request.category === "maintenance") {
    const { data } = await supabase
      .from("maintenance_details")
      .select("*")
      .eq("request_id", id)
      .maybeSingle();
    maintenanceDetails = data as MaintenanceDetails | null;
  } else if (request.category === "procurement") {
    const { data } = await supabase
      .from("procurement_line_items")
      .select("*")
      .eq("request_id", id);
    genericDetails = data;
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
    return profile.is_manager || t.allowed_roles.includes(profile.role);
  });

  const closeoutRow = closeout as RequestCloseout | null;
  const canManageCloseout = profile.is_manager || profile.role === "logistics_coordinator";

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
        {visibleTransitions.map((t) => (
          <StatusButton
            key={t.id}
            requestId={id}
            status={t.to_key}
            label={t.label}
            variant={t.variant}
          />
        ))}
        {isOwner && status === "returned_for_info" && (
          <StatusButton requestId={id} status="submitted" label="Resubmit" />
        )}
      </div>

      {status === "completed" && canManageCloseout && (
        <div className="mb-8">
          <CloseoutForm
            requestId={id}
            category={request.category}
            laborLines={request.category === "labor" ? laborSeedLines : undefined}
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
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                Maintenance details
              </h2>
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
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Delivery details</h2>
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

          {genericDetails && genericDetails.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                {CATEGORY_LABELS[request.category as Category]} details
              </h2>
              <pre className="text-xs text-slate-600 bg-slate-50 rounded-md p-3 overflow-x-auto">
                {JSON.stringify(genericDetails, null, 2)}
              </pre>
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
                    Cost breakdown
                  </h3>
                  <div className="overflow-hidden border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Type of Labor</th>
                          <th className="text-left px-3 py-2 font-medium">Quantity</th>
                          <th className="text-left px-3 py-2 font-medium">Cost/Labor</th>
                          <th className="text-left px-3 py-2 font-medium">Total value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(laborCloseoutLines as LaborCloseoutLine[]).map((l) => (
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-slate-900">{l.personnel_type}</td>
                            <td className="px-3 py-2 text-slate-700">{l.quantity}</td>
                            <td className="px-3 py-2 text-slate-700">
                              {l.cost_per_labor.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-slate-900 font-medium">
                              {l.total_value.toFixed(2)}
                            </td>
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
                  <p className="text-slate-700">{c.comment}</p>
                </div>
              ))}
              {(comments ?? []).length === 0 && (
                <p className="text-sm text-slate-400">No comments yet.</p>
              )}
            </div>
            <CommentBox requestId={id} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Details</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Project" value={request.project ?? "—"} />
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
