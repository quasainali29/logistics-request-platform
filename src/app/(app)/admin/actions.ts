"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role_info:roles!profiles_role_fkey(is_manager)")
    .eq("id", user.id)
    .single();

  if (!profile || !(profile.role_info as { is_manager: boolean } | null)?.is_manager) {
    redirect("/dashboard");
  }

  return { supabase, user };
}

// Fine-grained check for the newer permission-gated actions below. Falls
// back to redirecting home rather than throwing, matching requireManager's
// behavior for actions invoked from a plain form/page.
//
// is_manager is always an allowed override on top of the specific key —
// managers could do everything in this panel before the permissions matrix
// existed, and without this a manager whose role hasn't been explicitly
// granted a given key (e.g. only "main_admin" has manage_roles_permissions
// in the seed data) would otherwise be locked out of pages they can still
// see (the page-level checks already allow is_manager through).
async function requirePermission(key: string) {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, key)) {
    redirect("/admin?error=You+don't+have+permission+to+do+that");
  }
  const supabase = await createClient();
  return { supabase, profile };
}

export async function createRole(formData: FormData) {
  const { supabase } = await requireManager();

  const label = (formData.get("label") as string).trim();
  const rawName = ((formData.get("name") as string) || label).trim();
  const name = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const description = (formData.get("description") as string)?.trim() || null;
  const isStaff = formData.get("is_staff") === "on";
  const isManagerFlag = formData.get("is_manager") === "on";

  if (!name || !label) {
    redirect("/admin?error=Role+name+and+label+are+required");
  }

  const { error } = await supabase.from("roles").insert({
    name,
    label,
    description,
    is_staff: isStaff || isManagerFlag, // managers are always staff too
    is_manager: isManagerFlag,
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
}

export async function deleteRole(roleName: string) {
  const { supabase } = await requireManager();

  const { error } = await supabase.from("roles").delete().eq("name", roleName);

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
}

export async function assignUserRole(userId: string, roleName: string) {
  const { supabase } = await requireManager();

  const { error } = await supabase
    .from("profiles")
    .update({ role: roleName })
    .eq("id", userId);

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
}

export async function decideRoleRequest(
  requestId: string,
  decision: "approved" | "rejected",
  note?: string
) {
  const { supabase, user } = await requireManager();

  const { error } = await supabase.rpc("decide_role_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note || null,
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  // Best-effort email to the requestor — uses the admin client since the
  // decision has already committed and we just need to look up the address.
  try {
    const admin = createAdminClient();
    const { data: reqRow } = await admin
      .from("role_requests")
      .select("requested_role, user:profiles!role_requests_user_id_fkey(email, full_name)")
      .eq("id", requestId)
      .single();

    const requestorEmail = (reqRow?.user as unknown as { email: string } | null)?.email;
    if (requestorEmail) {
      await sendNotificationEmail({
        to: requestorEmail,
        subject:
          decision === "approved"
            ? `Your role request was approved`
            : `Your role request was not approved`,
        html:
          decision === "approved"
            ? `<p>Your request for the <strong>${reqRow?.requested_role}</strong> role has been approved.</p>`
            : `<p>Your request for the <strong>${reqRow?.requested_role}</strong> role was not approved.${
                note ? ` Note: ${note}` : ""
              }</p>`,
      });
    }
  } catch {
    // Email failures should never block the decision itself.
  }

  revalidatePath("/admin");
  revalidatePath("/account");

  // Reflect the decision-maker for completeness (not otherwise used).
  void user;
}

// ============================================================
// User management
// ============================================================

// Creates an account that is immediately active with a real password —
// no confirmation email, no invite link. The Supabase Auth user is created
// already-confirmed (email_confirm: true), so the admin can hand the
// email/password straight to the person and they can sign in right away.
// The `handle_new_user` DB trigger auto-creates the matching `profiles` row
// from the metadata we pass here, same as it does for invited users.
export async function createUserDirectly(formData: FormData) {
  const { supabase } = await requirePermission("manage_users");

  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const fullName = (formData.get("full_name") as string)?.trim();
  const password = (formData.get("password") as string) ?? "";
  const role = (formData.get("role") as string) || "requestor";
  // Admin-controlled per account, never mandatory — defaults to off unless
  // the admin explicitly checks the box for this specific account.
  const requirePasswordChange = formData.get("must_change_password") === "on";

  if (!email || !fullName) {
    redirect("/admin?error=Name+and+email+are+required");
  }
  if (password.length < 6) {
    redirect("/admin?error=Password+must+be+at+least+6+characters");
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    redirect(
      `/admin?error=${encodeURIComponent(
        `${existing.full_name} (${email}) already has an account.`
      )}`
    );
  }

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no verification email — the account is active now
    user_metadata: { full_name: fullName, role },
  });

  if (error || !created.user) {
    redirect(`/admin?error=${encodeURIComponent(error?.message ?? "Couldn't create account")}`);
  }

  if (requirePasswordChange) {
    await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", created.user.id);
  }

  revalidatePath("/admin");
}

export async function inviteUser(formData: FormData) {
  const { supabase } = await requireManager();

  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const fullName = (formData.get("full_name") as string)?.trim();
  const role = (formData.get("role") as string) || "requestor";

  if (!email || !fullName) {
    redirect("/admin?error=Name+and+email+are+required");
  }

  // Guard against re-inviting an email that already has an account — the
  // invite link authenticates as that existing user, so clicking it would
  // silently reset their real password. Point the admin at the Users table
  // (role assignment) instead.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    redirect(
      `/admin?error=${encodeURIComponent(
        `${existing.full_name} (${email}) already has an account. Use the role dropdown in the Users table instead of inviting them again.`
      )}`
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role },
    redirectTo: `${APP_URL}/auth/callback?next=/set-password`,
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
}

export async function deactivateUser(userId: string) {
  const { supabase, user } = await requireManager();

  if (userId === user.id) {
    redirect("/admin?error=You+can't+deactivate+your+own+account");
  }

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h", // effectively permanent, reversed on reactivate
  });
  if (authError) {
    redirect(`/admin?error=${encodeURIComponent(authError.message)}`);
  }

  await supabase.from("profiles").update({ status: "inactive" }).eq("id", userId);

  revalidatePath("/admin");
}

export async function reactivateUser(userId: string) {
  const { supabase } = await requireManager();

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (authError) {
    redirect(`/admin?error=${encodeURIComponent(authError.message)}`);
  }

  await supabase.from("profiles").update({ status: "active" }).eq("id", userId);

  revalidatePath("/admin");
}

export async function deleteUser(userId: string) {
  const { user } = await requireManager();

  if (userId === user.id) {
    redirect("/admin?error=You+can't+delete+your+own+account");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    const friendly = /foreign key|violates|constraint/i.test(error.message)
      ? "Can't delete this user — they still have requests on record. Deactivate them instead to keep the history intact."
      : error.message;
    redirect(`/admin?error=${encodeURIComponent(friendly)}`);
  }

  revalidatePath("/admin");
}

// ============================================================
// Roles & Permissions matrix
// ============================================================
// Both of these write through the service-role client rather than the
// per-request client: the RLS policies on permissions/role_permissions
// still gate on the coarse is_manager() flag (see migration 008), but the
// actual gate we want here is the fine-grained "manage_roles_permissions"
// permission — so a manager could grant that permission to a non-manager
// role and have it really work, instead of being silently blocked by RLS.
// requirePermission() is the real authorization check in both cases.

export async function setRolePermission(
  roleName: string,
  permissionKey: string,
  granted: boolean
) {
  const { profile } = await requirePermission("manage_roles_permissions");

  const admin = createAdminClient();
  const { error } = await admin
    .from("role_permissions")
    .update({ granted, updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("role_name", roleName)
    .eq("permission_key", permissionKey);

  if (error) {
    redirect(`/admin/permissions?error=${encodeURIComponent(error.message)}`);
  }

  revalidateTag("role-permissions", { expire: 0 });
  revalidatePath("/admin/permissions");
}

// Fully open-ended: the admin can invent brand-new permission rows, not
// just pick from a fixed list. The AFTER INSERT trigger on `permissions`
// (migration 008) automatically seeds an unchecked cell for every existing
// role, so the matrix never has a missing checkbox for it.
export async function createPermission(formData: FormData) {
  const { profile } = await requirePermission("manage_roles_permissions");

  const label = (formData.get("label") as string)?.trim();
  const category = (formData.get("category") as string)?.trim() || "Custom";
  const rawKey = ((formData.get("key") as string) || label || "").trim();
  const key = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!label || !key) {
    redirect("/admin/permissions?error=A+label+is+required");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("permissions").insert({
    key,
    label,
    category,
    sort_order: 999,
    created_by: profile.id,
  });

  if (error) {
    const friendly = /duplicate key|already exists/i.test(error.message)
      ? "A permission with that key already exists — try a different name."
      : error.message;
    redirect(`/admin/permissions?error=${encodeURIComponent(friendly)}`);
  }

  revalidateTag("role-permissions", { expire: 0 });
  revalidatePath("/admin/permissions");
}
