import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Runs daily via Vercel Cron (see vercel.json). Covers the Phase 5
// rules-based automations: overdue-request digest + expiry alerts.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: overdue } = await supabase
    .from("requests")
    .select("request_number, title, date_required")
    .lt("date_required", today)
    .not("status", "in", "(completed,closed,rejected)");

  const { data: vehiclesExpiring } = await supabase
    .from("vehicles")
    .select("vehicle_name, registration_expiry, insurance_expiry")
    .or(
      `registration_expiry.lte.${addDays(today, 30)},insurance_expiry.lte.${addDays(today, 30)}`
    );

  const { data: driversExpiring } = await supabase
    .from("drivers")
    .select("full_name, license_expiry")
    .lte("license_expiry", addDays(today, 30));

  const { data: coordinators } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["logistics_coordinator", "logistics_manager"])
    .eq("status", "active");

  const emails = (coordinators ?? []).map((c) => c.email).filter(Boolean);

  if (
    emails.length > 0 &&
    ((overdue?.length ?? 0) > 0 ||
      (vehiclesExpiring?.length ?? 0) > 0 ||
      (driversExpiring?.length ?? 0) > 0)
  ) {
    const html = `
      <h2>Daily digest</h2>
      ${
        overdue && overdue.length > 0
          ? `<h3>Overdue requests (${overdue.length})</h3><ul>${overdue
              .map((r) => `<li>${r.request_number} — ${r.title} (due ${r.date_required})</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        vehiclesExpiring && vehiclesExpiring.length > 0
          ? `<h3>Vehicle documents expiring within 30 days</h3><ul>${vehiclesExpiring
              .map((v) => `<li>${v.vehicle_name}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        driversExpiring && driversExpiring.length > 0
          ? `<h3>Driver licenses expiring within 30 days</h3><ul>${driversExpiring
              .map((d) => `<li>${d.full_name}</li>`)
              .join("")}</ul>`
          : ""
      }
      <p><a href="${APP_URL}/dashboard">Open dashboard</a></p>
    `;

    await sendNotificationEmail({
      to: emails,
      subject: "Logistics Platform — daily digest",
      html,
    });
  }

  return NextResponse.json({
    ok: true,
    overdue: overdue?.length ?? 0,
    vehiclesExpiring: vehiclesExpiring?.length ?? 0,
    driversExpiring: driversExpiring?.length ?? 0,
  });
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
