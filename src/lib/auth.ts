import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/types";
import { getRolePermissionKeys } from "@/lib/cachedLookups";

// Wrapped in React's cache() so that within a single request, calling
// getProfile() from the (app) layout AND again from the page underneath it
// (which is the norm — nearly every page re-checks the profile for its own
// permission gating) only does the actual auth/profile lookup once instead
// of twice. This is per-request memoization only (reset on every new
// request), not a persistent cache — safe for per-user session data.
export const getProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*, role_info:roles!profiles_role_fkey(is_staff, is_manager)")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/login");
  }

  const { role_info, ...rest } = profile as Profile & {
    role_info: { is_staff: boolean; is_manager: boolean } | null;
  };

  // Granted permission keys for this profile's role — the source of truth
  // for the fine-grained checks in @/lib/permissions. is_staff/is_manager
  // above remain in place as a coarser backstop used by RLS. Cached per
  // role name (see @/lib/cachedLookups) since this is identical for every
  // user sharing a role and rarely changes.
  const permissions = await getRolePermissionKeys(rest.role);

  return {
    ...rest,
    is_staff: role_info?.is_staff ?? false,
    is_manager: role_info?.is_manager ?? false,
    permissions,
  };
});
