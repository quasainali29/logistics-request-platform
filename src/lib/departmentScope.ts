import type { SupabaseClient } from "@supabase/supabase-js";

// Roles that see every request regardless of department -- named
// explicitly rather than derived from is_manager, since is_manager alone
// no longer means "sees everything" once department-scoped manager roles
// exist. "main_admin" isn't seeded as an actual role anywhere yet (it's
// only referenced in some older permission-grant migrations), but is
// listed here now so creating it later via Admin > Roles doesn't also
// require a code change -- harmless no-op reference until then.
const SEES_ALL_MANAGER_ROLES = new Set(["logistics_manager", "main_admin"]);

// Returns null when this profile isn't a department-scoped manager at all
// (a plain requestor, coordinator, technician, warehouse_team member, or
// one of the SEES_ALL_MANAGER_ROLES above) -- callers should apply no
// department filter in that case. Returns a (possibly empty) array of
// department names otherwise -- an empty array means this manager hasn't
// been assigned any department yet, so they should see nothing rather
// than everything.
export async function getManagerDepartmentScope(
  supabase: SupabaseClient,
  profile: { id: string; role: string; is_manager?: boolean | null }
): Promise<string[] | null> {
  if (!profile.is_manager) return null;
  if (SEES_ALL_MANAGER_ROLES.has(profile.role)) return null;

  const { data } = await supabase
    .from("department_managers")
    .select("department:departments!department_managers_department_id_fkey(name)")
    .eq("manager_id", profile.id);

  return ((data ?? []) as any[])
    .map((row) => row.department?.name as string | undefined)
    .filter((name): name is string => !!name);
}

// A department name list that would never match a real department (avoids
// the empty-array edge case where Postgres' `.in()` with zero values can
// behave differently across drivers -- an obviously-unmatchable literal is
// simpler to reason about than relying on that).
export const NO_DEPARTMENT_MATCH = ["__no_department_assigned__"];
