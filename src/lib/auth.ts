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

  return {
    ...rest,
    is_staff: role_info?.is_staff ?? false,
    is_manager: role_info?.is_manager ?? false,
  };
}
