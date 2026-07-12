import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { STATUS_LABELS, type RequestStatus } from "@/lib/types";

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
  const notifyRequestorStatuses: RequestStatus[] = [
    "approved",
    "rejected",
    "returned_for_info",
    "dispatched",
    "completed",
    "closed",
  ];

  if (status === "under_review") {
    // New request needs staff attention — notify Logistics Coordinators.
    const { data: coordinators } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "logistics_coordinator")
      .eq("status", "active");

    const emails = (coordinators ?? []).map((c) => c.email).filter(Boolean);
    if (emails.length > 0) {
      await sendNotificationEmail({
        to: emails,
        subject: `New request needs review: ${request.title}`,
        html: `<p><strong>${request.request_number} — ${request.title}</strong> was submitted by ${request.requestor?.full_name} and needs review.</p><p><a href="${link}">View request</a></p>`,
      });
    }
  }

  if (notifyRequestorStatuses.includes(status) && request.requestor?.email) {
    await sendNotificationEmail({
      to: request.requestor.email,
      subject: `${request.request_number} is now ${statusLabel}`,
      html: `<p>Your request <strong>${request.title}</strong> (${request.request_number}) is now <strong>${statusLabel}</strong>.</p><p><a href="${link}">View request</a></p>`,
    });
  }

  return NextResponse.json({ ok: true });
}
