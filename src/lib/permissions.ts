import type { Profile } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";

// Returns true if the profile's role has been granted this permission key.
// This is the one place every server action / page should call through —
// never check profile.permissions directly, so the fallback behavior
// (missing key = denied) stays consistent everywhere.
export function can(profile: Pick<Profile, "permissions">, key: string): boolean {
  return profile.permissions.includes(key);
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
