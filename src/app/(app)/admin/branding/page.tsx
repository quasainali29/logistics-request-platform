import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { AppSettings } from "@/lib/types";
import { AdminNav } from "../AdminNav";
import { updateBranding } from "./actions";

export default async function BrandingAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile.is_manager) redirect("/dashboard");

  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", true)
    .single();

  const appSettings = settings as AppSettings | null;

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage users, roles, workflow, and branding.
        </p>
      </div>

      <AdminNav active="branding" />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3 mb-6">
          {decodeURIComponent(error)}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Branding</h2>
        <p className="text-xs text-slate-500 mb-5">
          Applied across the sidebar, login page, and dashboard.
        </p>

        <form action={updateBranding} className="space-y-6" encType="multipart/form-data">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Organization name
            </label>
            <input
              name="org_name"
              defaultValue={appSettings?.org_name ?? "Logistics Platform"}
              className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Accent color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                name="accent_color"
                defaultValue={appSettings?.accent_color ?? "#1f4e78"}
                className="h-10 w-16 rounded border border-slate-300 cursor-pointer"
              />
              <span className="text-xs text-slate-500">
                Used for buttons, links, and the sidebar accent.
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Logo</label>
            {appSettings?.logo_url ? (
              <div className="flex items-center gap-4 mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={appSettings.logo_url}
                  alt="Current logo"
                  className="h-12 w-12 object-contain rounded-md border border-slate-200 bg-white p-1"
                />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="remove_logo" className="rounded border-slate-300" />
                  Remove current logo
                </label>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mb-3">
                No logo set — the sidebar shows a plain letter badge instead.
              </p>
            )}
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">PNG, JPG, SVG, or WebP. Under 2MB.</p>
          </div>

          <button
            type="submit"
            className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
          >
            Save Branding
          </button>
        </form>
      </section>
    </div>
  );
}
