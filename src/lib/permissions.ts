import type { Profile } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRolePermissionKeys } from "@/lib/cachedLookups";
import type { SupabaseClient } from "@supabase/supabase-js";

// Returns true if the profile's role has been granted this permission key.
// This is the one place every server action / page should call through —
// never check profile.permissions directly, so the fallback behavior
// (missing key = denied) stays consistent everywhere.
export function can(profile: Pick<Profile, "permissions">, key: string): boolean {
  return profile.permissions.includes(key);
}

// The two roles that bypass the permissions matrix entirely and can do
// anything the app exposes -- logistics_manager is the platform's
// existing top-level role, and main_admin is reserved for whenever it's
// created (see requests/[id]/page.tsx and lib/departmentScope.ts, which
// use the same two-role list for their own "sees everything" carve-outs).
// Every OTHER role, including any custom is_manager=true role created via
// Admin > Roles, is governed strictly by what's checked in the matrix --
// is_manager alone no longer means "can do anything manager-related".
const SUPER_ROLES = new Set(["logistics_manager", "main_admin"]);

export function isSuperRole(role: string): boolean {
  return SUPER_ROLES.has(role);
}

// The one check almost every gated action/page should use: a super role
// can always proceed; anyone else needs the specific permission granted.
export function canDo(profile: Pick<Profile, "permissions" | "role">, key: string): boolean {
  return isSuperRole(profile.role) || can(profile, key);
}

// Server-action equivalent of canDo() above, for the many actions in
// requests/actions.ts (and elsewhere) that only have a userId from
// supabase.auth.getUser() -- not the full Profile object getProfile()
// builds for pages. Looks up just the role, then reuses the same cached
// role_permissions lookup getProfile() itself relies on.
export async function currentUserCanDo(
  supabase: SupabaseClient,
  userId: string,
  key: string
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (!profile) return false;
  if (isSuperRole(profile.role)) return true;
  const keys = await getRolePermissionKeys(profile.role);
  return keys.includes(key);
}

export interface PermissionRow {
  key: string;
  label: string;
  category: string;
  sort_order: number;
}

export interface RolePermissionCell {
  role_name: string;
  permission_key: string;
  granted: boolean;
}

// Full matrix fetch for the Admin > Roles & Permissions page. Not cached —
// this page is edited live by managers and always needs fresh state right
// after a checkbox toggle or a new role/permission is added.
export async function getPermissionMatrix() {
  const supabase = createAdminClient();
  const [{ data: permissions }, { data: cells }] = await Promise.all([
    supabase
      .from("permissions")
      .select("key, label, category, sort_order")
      .order("category")
      .order("sort_order"),
    supabase.from("role_permissions").select("role_name, permission_key, granted"),
  ]);

  return {
    permissions: (permissions ?? []) as PermissionRow[],
    cells: (cells ?? []) as RolePermissionCell[],
  };
}
