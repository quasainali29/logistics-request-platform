import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { STATUS_LABELS, type RequestStatus } from "@/lib/types";
import {
  buildRequestEmailHtml,
  fetchCategoryDetails,
  resolveProjectName,
  type EmailCostLine,
} from "@/lib/emailTemplates";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const REASON_STATUSES = new Set(["returned_for_info", "rejected"]);
const COST_STATUSES = new Set(["completed", "closed"]);

const HEADLINE_OVERRIDES: Record<string, string> = {
  returned_for_info: "Your request needs more information",
  rejected: "Your request needs more information",
  completed: "Your request has been completed",
  closed: "Your request has been closed",
};

export async function POST(req: NextRequest) {
  const { requestId, status, reason } = (await req.json()) as {
    requestId: string;
    status: RequestStatus;
    reason?: string;
  };

  const supabase = createAdminClient();

  const { data: request } = await supabase
    .from("requests")
    .select("*, requestor:profiles!requests_requestor_id_fkey(full_name, email)")
    .eq("id", requestId)
    .single();

  if (!request) {
    return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
  }

  const link = `${APP_URL}/requests/${requestId}`;
  const statusLabel = STATUS_LABELS[status];

  const notifyRequestorStatuses: RequestStatus[] = [
    "approved",
    "rejected",
    "returned_for_info",
    "dispatched",
    "completed",
    "closed",
  ];

  if (notifyRequestorStatuses.includes(status) && request.requestor?.email) {
    const [categoryDetails, projectName] = await Promise.all([
      fetchCategoryDetails(supabase, request.category, requestId),
      resolveProjectName(supabase, request.project, request.project_id),
    ]);

    let costLines: EmailCostLine[] | undefined;
    let costTotal: number | undefined;
    if (COST_STATUSES.has(status)) {
      const { data: lines } = await supabase
        .from("request_cost_lines")
        .select("cost_category, description, amount")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });

      costLines = (lines ?? []).map((l) => ({
        category: l.cost_category as string,
        description: l.description as string | null,
        amount: Number(l.amount),
      }));
      costTotal = costLines.reduce((sum, l) => sum + l.amount, 0);
    }

    await sendNotificationEmail({
      to: request.requestor.email,
      subject: `${request.request_number} is now ${statusLabel}`,
      html: buildRequestEmailHtml({
        requestNumber: request.request_number,
        title: request.title,
        category: request.category,
        priority: request.priority,
        status,
        project: projectName,
        department: request.department,
        dateRequired: request.date_required,
        concludeDate: request.conclude_date,
        description: request.description,
        specialInstructions: request.special_instructions,
        categoryDetails,
        costLines,
        costTotal,
        reason: REASON_STATUSES.has(status) ? reason ?? null : undefined,
        headline: HEADLINE_OVERRIDES[status] ?? `Your request is now ${statusLabel}`,
        ctaLabel: REASON_STATUSES.has(status) ? "View and resubmit" : "View request",
        ctaUrl: link,
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
