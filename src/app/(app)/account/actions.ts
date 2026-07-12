"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function requestRole(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const requestedRole = formData.get("requested_role") as string;
  const note = (formData.get("note") as string)?.trim() || null;

  if (!requestedRole) {
    redirect("/account?error=Pick+a+role+to+request");
  }

  const { error } = await supabase.from("role_requests").insert({
    user_id: user.id,
    requested_role: requestedRole,
    note,
  });

  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }

  // Notify managers — best-effort, non-blocking.
  try {
    const admin = createAdminClient();
    const { data: managers } = await admin
      .from("profiles")
      .select("email, role, role_info:roles!profiles_role_fkey(is_manager)")
      .eq("status", "active");

    const managerEmails = (managers ?? [])
      .filter((m) => (m.role_info as unknown as { is_manager: boolean } | null)?.is_manager)
      .map((m) => m.email)
      .filter(Boolean);

    const { data: requester } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    if (managerEmails.length > 0) {
      await sendNotificationEmail({
        to: managerEmails,
        subject: `Role request: ${requester?.full_name ?? "A user"} wants ${requestedRole}`,
        html: `<p><strong>${requester?.full_name ?? "A user"}</strong> requested the <strong>${requestedRole}</strong> role.${
          note ? `<br/>Note: ${note}` : ""
        }</p><p>Review it in the Admin panel.</p>`,
      });
    }
  } catch {
    // Non-blocking.
  }

  revalidatePath("/account");
}
