"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";

// Same is_manager-backstop pattern as admin/projects/actions.ts's
// requirePermission: the fine-grained "manage_departments" grant is the
// real check, but a manager can never be locked out of a page they can
// already see.
async function requirePermission(key: string) {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, key)) {
    redirect("/admin/departments?error=You+don't+have+permission+to+do+that");
  }
  return profile;
}

export async function createDepartment(formData: FormData) {
  await requirePermission("manage_departments");

  const name = (formData.get("name") as string)?.trim();

  if (!name) {
    redirect("/admin/departments?error=Department+name+is+required");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("departments").insert({ name });

  if (error) {
    // Most likely cause: the unique constraint on name (e.g. re-adding one
    // that already exists, case-sensitive match).
    redirect(`/admin/departments?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/departments");
  updateTag("departments");
}

// Soft delete only. Requests that already have this department's name
// stored as plain text are untouched -- this only removes it from the
// dropdown for new requests going forward.
export async function deleteDepartment(departmentId: string) {
  await requirePermission("manage_departments");

  const admin = createAdminClient();
  const { error } = await admin
    .from("departments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", departmentId);

  if (error) {
    redirect(`/admin/departments?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/departments");
  updateTag("departments");
}
