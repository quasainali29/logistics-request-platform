import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/types";

export async function getProfile(): Promise<Profile> {
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
  // above remain in place as a coarser backstop used by RLS.
  const { data: grants } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role_name", rest.role)
    .eq("granted", true);

  return {
    ...rest,
    is_staff: role_info?.is_staff ?? false,
    is_manager: role_info?.is_manager ?? false,
    permissions: (grants ?? []).map((g) => g.permission_key as string),
  };
}
