import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/types";

// Every report page/CSV route calls through here. Mirrors the
// requirePermission() pattern used by admin/projects/actions.ts:
// is_manager is always kept as a backstop/override alongside the
// fine-grained permission check, so a manager is never locked out of a
// report even if that specific key hasn't been explicitly granted to
// their role yet.
export async function requireReportPermission(key: string): Promise<Profile> {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, key)) {
    redirect("/reports?error=You+don't+have+permission+to+view+that+report");
  }
  return profile;
}
