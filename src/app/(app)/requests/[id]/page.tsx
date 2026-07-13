import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatStatusLabel,
  statusColor,
  PRIORITY_COLORS,
  CATEGORY_LABELS,
  PURCHASING_CATEGORIES,
  NATURE_OF_WORK_OPTIONS,
  LABOR_TYPES,
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
} from "@/lib/types";

function labelFor(options: readonly { value: string; label: string }[], value: string | null) {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}
import { StatusButton, CommentBox } from "./actions-client";
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
      "*, requestor:profiles!requests_requestor_id_fkey(full_name, email), approver:profiles!requests_approved_by_fkey(full_name)"
    )
    .eq("id", id)
    .single();

  if (!request) notFound();

  const [{ data: comments }, { data: history }, { data: stages }, { data: transitions }] =
    await Promise.all([
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
    ]);

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
  // action enforces in requests/actions.ts).
  const visibleTransitions = availableTransitions.filter(
    (t) => profile.is_manager || t.allowed_roles.includes(profile.role)
  );

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

          {request.category === "labor" && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Labor details</h2>
              <dl className="space-y-2 text-sm mb-4">
                <Row
                  label="Date from"
                  value={
                    laborLines[0]?.date_from
                      ? format(parseISO(laborLines[0].date_from), "MMM d, yyyy")
                      : "—"
                  }
                />
                <Row
                  label="Date to"
                  value={
                    laborLines[0]?.date_to
                      ? format(parseISO(laborLines[0].date_to), "MMM d, yyyy")
                      : "—"
                  }
                />
              </dl>

              {laborLines.length > 0 && (
                <div className="overflow-hidden border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">#</th>
                        <th className="text-left px-3 py-2 font-medium">
                          Type of requirement
                        </th>
                        <th className="text-left px-3 py-2 font-medium">Nature of work</th>
                        <th className="text-left px-3 py-2 font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {laborLines.map((line, i) => (
                        <tr key={line.id}>
                          <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2 text-slate-900">
                            {labelFor(LABOR_TYPES, line.personnel_type)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {labelFor(NATURE_OF_WORK_OPTIONS, line.nature_of_work)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{line.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {request.category === "procurement" && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                Procurement details
              </h2>
              <dl className="space-y-2 text-sm mb-4">
                <Row
                  label="Purchasing category"
                  value={
                    procurementDetails?.purchasing_category === "other"
                      ? procurementDetails?.purchasing_category_other || "Other"
                      : labelFor(
                          PURCHASING_CATEGORIES,
                          procurementDetails?.purchasing_category ?? null
                        )
                  }
                />
                <Row label="Vendor" value={procurementDetails?.vendor ?? "—"} />
                <Row
                  label="Needed by"
                  value={
                    procurementDetails?.needed_by_date
                      ? format(parseISO(procurementDetails.needed_by_date), "MMM d, yyyy")
                      : "—"
                  }
                />
              </dl>

              {procurementItems.length > 0 && (
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
                          <th className="text-left px-3 py-2 font-medium">Purchasing link</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {procurementItems.map((it) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 text-slate-500">{it.item_no}</td>
                            <td className="px-3 py-2 text-slate-900">
                              {it.item_description}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{it.quantity}</td>
                            <td className="px-3 py-2">
                              {it.image_url ? (
                                <a href={it.image_url} target="_blank" rel="noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={it.image_url}
                                    alt={it.item_description ?? "Item image"}
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
                                  Link
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
                </div>
              )}
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
