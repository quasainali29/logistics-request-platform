import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkflowStage } from "@/lib/types";
import type { AmcLocation, AmcType } from "@/lib/types";
import type { Project } from "@/lib/types";

// These are near-static reference/lookup tables that get re-fetched on
// almost every page load (dashboard, requests list, request detail, AMC
// list, AMC new-contract form) even though they change only rarely — a
// manager edits a workflow stage, or someone adds a location/AMC type.
//
// We use a service-role client here (not the per-request cookie-scoped
// client) specifically so the cached function has no dependency on the
// current user's session — `unstable_cache` cannot wrap a function that
// calls `cookies()`/`headers()`, and more importantly, caching a value
// derived from one user's session would leak across users. These tables
// are readable by any authenticated user and identical for all of them,
// so a single shared cache entry is correct.
//
// Each entry also has a 5 minute time-based fallback (`revalidate`) in
// case a cache-invalidating action is ever added somewhere without a
// matching `revalidateTag` call.

export const getWorkflowStages = unstable_cache(
  async (): Promise<WorkflowStage[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase.from("workflow_stages").select("*");
    return (data ?? []) as WorkflowStage[];
  },
  ["workflow-stages"],
  { tags: ["workflow-stages"], revalidate: 300 }
);

export const getAmcLocations = unstable_cache(
  async (): Promise<AmcLocation[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase.from("amc_locations").select("*").order("name");
    return (data ?? []) as AmcLocation[];
  },
  ["amc-locations"],
  { tags: ["amc-locations"], revalidate: 300 }
);

export const getAmcTypes = unstable_cache(
  async (): Promise<AmcType[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase.from("amc_types").select("*").order("name");
    return (data ?? []) as AmcType[];
  },
  ["amc-types"],
  { tags: ["amc-types"], revalidate: 300 }
);

// Active (not soft-deleted) projects, for the request-form dropdown. Not
// filtered by status (active/completed/on_hold) — a completed project can
// still be a valid choice for a new request about it; deleted_at is the
// only thing that removes it from the list.
export const getActiveProjects = unstable_cache(
  async (): Promise<Project[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("projects")
      .select("*")
      .is("deleted_at", null)
      .order("name");
    return (data ?? []) as Project[];
  },
  ["active-projects"],
  { tags: ["projects"], revalidate: 300 }
);

// app_settings (branding/org name/accent color/login page look) is a
// single global row read on literally every page render (root layout for
// metadata + <html> accent var, the (app) layout for the sidebar, and the
// login page) — same rarely-changes-but-fetched-constantly profile as the
// lookups above, so it gets the same treatment. Invalidated explicitly via
// revalidateTag("app-settings") from updateBranding() in
// admin/branding/actions.ts, with the same 5-minute fallback.
export const getAppSettings = unstable_cache(
  async () => {
    const supabase = createAdminClient();
    const { data } = await supabase.from("app_settings").select("*").eq("id", true).single();
    return data;
  },
  ["app-settings"],
  { tags: ["app-settings"], revalidate: 300 }
);

// The granted permission keys for a given role. getProfile() (see
// @/lib/auth) used to run this as a fresh per-request query against the
// per-user cookie-scoped client every single time — but the set of
// permissions granted to e.g. "logistics_coordinator" is identical for
// every user with that role and rarely changes, so it's cached per role
// name here instead. Invalidated via revalidateTag("role-permissions")
// from setRolePermission()/createPermission() in admin/actions.ts.
export const getRolePermissionKeys = unstable_cache(
  async (roleName: string): Promise<string[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .eq("role_name", roleName)
      .eq("granted", true);
    return (data ?? []).map((g) => g.permission_key as string);
  },
  ["role-permissions"],
  { tags: ["role-permissions"], revalidate: 300 }
);
