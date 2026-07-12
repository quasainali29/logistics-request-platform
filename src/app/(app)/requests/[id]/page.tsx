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
} from "@/lib/types";
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

  let categoryDetails: Record<string, unknown>[] | null = null;
  if (request.category === "delivery") {
    const { data } = await supabase
      .from("delivery_details")
      .select("*")
      .eq("request_id", id);
    categoryDetails = data;
  } else if (request.category === "labor") {
    const { data } = await supabase
      .from("labor_personnel_lines")
      .select("*")
      .eq("request_id", id);
    categoryDetails = data;
  } else if (request.category === "maintenance") {
    const { data } = await supabase
      .from("maintenance_details")
      .select("*")
      .eq("request_id", id);
    categoryDetails = data;
  } else if (request.category === "procurement") {
    const { data } = await supabase
      .from("procurement_line_items")
      .select("*")
      .eq("request_id", id);
    categoryDetails = data;
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

          {categoryDetails && categoryDetails.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                {CATEGORY_LABELS[request.category as Category]} details
              </h2>
              <pre className="text-xs text-slate-600 bg-slate-50 rounded-md p-3 overflow-x-auto">
                {JSON.stringify(categoryDetails, null, 2)}
              </pre>
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
              <Row label="Department" value={request.department ?? "—"} />
              <Row
                label="Date required"
                value={
                  request.date_required
                    ? format(parseISO(request.date_required), "MMM d, yyyy")
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
