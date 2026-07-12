import { Resend } from "resend";

// Sender must be a verified domain in Resend. Until a custom domain is
// verified, Resend's shared "onboarding@resend.dev" address works for testing.
const FROM = process.env.NOTIFY_FROM_EMAIL ?? "Logistics Platform <onboarding@resend.dev>";

export async function sendNotificationEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email:", params.subject);
    return;
  }
  try {
    // Instantiated lazily (not at module load) so builds succeed even before
    // RESEND_API_KEY is configured in the environment.
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
  } catch (err) {
    console.error("Failed to send notification email:", err);
  }
}
