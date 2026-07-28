import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { STATUS_LABELS, type RequestStatus } from "@/lib/types";
import { buildRequestEmailHtml, fetchCategoryDetails, resolveProjectName } from "@/lib/emailTemplates";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  const { requestId, status } = (await req.json()) as {
    requestId: string;
    status: RequestStatus;
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

  // Who gets notified for each transition, and what the email says.
  // Matches the Phase 2 notification map / Phase 5 automation catalog.
  //
  // Note: the initial "new request needs review" email (to logistics
  // managers) and the "your request was submitted" confirmation (to the
  // requestor) are sent directly from createRequest() in requests/actions.ts
  // at creation time, not through this status-transition route — this route
  // only fires on statuses a request can move *into* after that (approved,
  // returned_for_info, dispatched, completed, closed). A stale "under_review"
  // branch used to live here targeting logistics_coordinator, but no code
  // path sets that status anymore (managers act directly on "submitted"
  // requests via the Approve/Reject + assign flow), so it was dead code and
  // has been removed.
  const notifyRequestorStatuses: RequestStatus[] = [
    "approved",
    "rejected",
    "returned_for_info",
    "dispatched",
    "completed",
    "closed",
  ];

  if (notifyRequestorStatuses.includes(status) && request.requestor?.email) {
    // Category-specific fields and the resolved project name aren't part of
    // the base `requests` row, so they're pulled in here — same helpers the
    // creation and assignment emails use, keeping every notification for a
    // request looking and reading the same way.
    const [categoryDetails, projectName] = await Promise.all([
      fetchCategoryDetails(supabase, request.category, requestId),
      resolveProjectName(supabase, request.project, request.project_id),
    ]);

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
        headline: `Your request is now ${statusLabel}`,
        ctaLabel: "View request",
        ctaUrl: link,
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
