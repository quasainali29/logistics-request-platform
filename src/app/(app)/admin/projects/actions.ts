"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";

// Same is_manager-backstop pattern as admin/actions.ts's requirePermission:
// the fine-grained "manage_projects" grant is the real check, but a
// manager can never be locked out of a page they can already see.
async function requirePermission(key: string) {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, key)) {
    redirect("/admin/projects?error=You+don't+have+permission+to+do+that");
  }
  return profile;
}

export async function createProject(formData: FormData) {
  await requirePermission("manage_projects");

  const name = (formData.get("name") as string)?.trim();
  const client = (formData.get("client") as string)?.trim() || null;
  const status = (formData.get("status") as string) || "active";

  if (!name) {
    redirect("/admin/projects?error=Project+name+is+required");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("projects").insert({ name, client, status });

  if (error) {
    redirect(`/admin/projects?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/projects");
  updateTag("projects");
}

export async function setProjectStatus(projectId: string, status: string) {
  await requirePermission("manage_projects");

  const admin = createAdminClient();
  const { error } = await admin.from("projects").update({ status }).eq("id", projectId);

  if (error) {
    redirect(`/admin/projects?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/projects");
  updateTag("projects");
}

// Soft delete only. Requests already linked via project_id keep that link
// (the FK is untouched) -- the app shows "Unavailable Project" for them
// instead of the real name, and this project stops appearing as a choice
// on the request form going forward.
export async function deleteProject(projectId: string) {
  await requirePermission("manage_projects");

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    redirect(`/admin/projects?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/projects");
  updateTag("projects");
}
