"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";

export async function updateBranding(formData: FormData) {
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

  const orgName = (formData.get("org_name") as string)?.trim();
  const accentColor = (formData.get("accent_color") as string)?.trim();
  const loginBgColor = (formData.get("login_bg_color") as string)?.trim();
  const loginLogoSizeRaw = formData.get("login_logo_size") as string | null;
  const loginLogoSize = loginLogoSizeRaw ? parseInt(loginLogoSizeRaw, 10) : undefined;
  const logoFile = formData.get("logo") as File | null;
  const removeLogo = formData.get("remove_logo") === "on";

  const updates: Record<string, unknown> = {
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  if (orgName) updates.org_name = orgName;
  if (accentColor) updates.accent_color = accentColor;
  if (loginBgColor) updates.login_bg_color = loginBgColor;
  if (loginLogoSize && !Number.isNaN(loginLogoSize)) updates.login_logo_size = loginLogoSize;

  if (removeLogo) {
    updates.logo_url = null;
  } else if (logoFile && logoFile.size > 0) {
    if (logoFile.size > 2 * 1024 * 1024) {
      redirect("/admin/branding?error=Logo+must+be+under+2MB");
    }

    const ext = logoFile.name.split(".").pop() || "png";
    const path = `logo-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("branding")
      .upload(path, logoFile, { upsert: true, contentType: logoFile.type });

    if (uploadError) {
      redirect(`/admin/branding?error=${encodeURIComponent(uploadError.message)}`);
    }

    const { data: publicUrl } = supabase.storage.from("branding").getPublicUrl(path);
    updates.logo_url = publicUrl.publicUrl;
  }

  const { error } = await supabase.from("app_settings").update(updates).eq("id", true);

  if (error) {
    redirect(`/admin/branding?error=${encodeURIComponent(error.message)}`);
  }

  revalidateTag("app-settings", { expire: 0 });
  revalidatePath("/", "layout");
}
