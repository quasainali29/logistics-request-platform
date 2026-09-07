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

  // AMC reminders: a separate email, to a manager-managed recipient list
  // (see migration 023 / src/app/(app)/amc/page.tsx "Email reminders"
  // panel) rather than the coordinator/manager list above, since these
  // addresses aren't necessarily platform users.
  const [{ data: reminderRules }, { data: reminderRecipients }, { data: amcContracts }] =
    await Promise.all([
      supabase.from("amc_reminder_rules").select("*").eq("enabled", true),
      supabase.from("amc_reminder_recipients").select("email"),
      supabase
        .from("amc_contracts")
        .select(
          "id, next_maintenance_date, contract_end, supplier_name, location:amc_locations(name), type:amc_types(name)"
        ),
    ]);

  const amcRecipientEmails = (reminderRecipients ?? []).map((r) => r.email).filter(Boolean);
  const enabledRules = reminderRules ?? [];

  if (amcRecipientEmails.length > 0 && enabledRules.length > 0 && amcContracts) {
    type AmcRow = {
      id: string;
      next_maintenance_date: string;
      contract_end: string | null;
      supplier_name: string;
      location: { name: string } | null;
      type: { name: string } | null;
    };
    const contractsList = amcContracts as unknown as AmcRow[];

    const dueSoonRules = enabledRules.filter((r) => r.reminder_type === "due_soon");
    const expiryRules = enabledRules.filter((r) => r.reminder_type === "expiry");
    const overdueEnabled = enabledRules.some((r) => r.reminder_type === "overdue");

    const dueSoonMatches: { contract: AmcRow; daysBefore: number }[] = [];
    const expiryMatches: { contract: AmcRow; daysBefore: number }[] = [];
    const overdueMatches: AmcRow[] = [];

    for (const contract of contractsList) {
      const dueDiff = diffCalendarDays(contract.next_maintenance_date, today);
      for (const rule of dueSoonRules) {
        if (dueDiff === rule.days_before) dueSoonMatches.push({ contract, daysBefore: rule.days_before });
      }
      // Fires exactly once -- the single day after next_maintenance_date
      // passes -- rather than every day it remains overdue.
      if (overdueEnabled && dueDiff === -1) overdueMatches.push(contract);

      if (contract.contract_end) {
        const expiryDiff = diffCalendarDays(contract.contract_end, today);
        for (const rule of expiryRules) {
          if (expiryDiff === rule.days_before) expiryMatches.push({ contract, daysBefore: rule.days_before });
        }
      }
    }

    const describe = (c: AmcRow) => `${c.location?.name ?? "Unknown location"} — ${c.type?.name ?? "Unknown type"} (${c.supplier_name})`;

    if (dueSoonMatches.length > 0 || expiryMatches.length > 0 || overdueMatches.length > 0) {
      const amcHtml = `
        <h2>AMC contract reminders</h2>
        ${
          dueSoonMatches.length > 0
            ? `<h3>Maintenance due soon</h3><ul>${dueSoonMatches
                .map(
                  (m) =>
                    `<li>${describe(m.contract)} — due ${m.contract.next_maintenance_date} (${m.daysBefore} day${m.daysBefore === 1 ? "" : "s"} away)</li>`
                )
                .join("")}</ul>`
            : ""
        }
        ${
          expiryMatches.length > 0
            ? `<h3>Contracts nearing expiry</h3><ul>${expiryMatches
                .map(
                  (m) =>
                    `<li>${describe(m.contract)} — ends ${m.contract.contract_end} (${m.daysBefore} day${m.daysBefore === 1 ? "" : "s"} away)</li>`
                )
                .join("")}</ul>`
            : ""
        }
        ${
          overdueMatches.length > 0
            ? `<h3>Now overdue</h3><ul>${overdueMatches
                .map((c) => `<li>${describe(c)} — was due ${c.next_maintenance_date}</li>`)
                .join("")}</ul>`
            : ""
        }
        <p><a href="${APP_URL}/amc">Open AMC contracts</a></p>
      `;

      await sendNotificationEmail({
        to: amcRecipientEmails,
        subject: "AMC contract reminders",
        html: amcHtml,
      });
    }
  }

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

// Whole calendar days from `today` to `dateStr` (positive = in the
// future, negative = in the past) -- both are YYYY-MM-DD strings, so this
// avoids any time-of-day/timezone drift from constructing Date objects
// with an implicit local time.
function diffCalendarDays(dateStr: string, todayStr: string) {
  const date = new Date(dateStr + "T00:00:00Z");
  const today = new Date(todayStr + "T00:00:00Z");
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}
