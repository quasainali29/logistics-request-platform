// These 5 keys are baked into the application as plain string comparisons
// in ~20 places (dashboard views, document-generation gates, digest
// recipients, the manager-edit-request flow, and the seed data for every
// permissions migration). Renaming one of them wouldn't fail loudly — the
// role would keep working in the Roles table and permissions matrix, but
// every hardcoded `profile.role === "..."` check elsewhere in the app would
// silently stop matching it. Display name, description, and the
// Staff/Manager flags are still fully editable for these roles; only the
// internal key is locked. Custom roles created later have no such
// hardcoded references, so their key can be renamed freely.
//
// Shared between the server action (admin/actions.ts, which enforces this)
// and the client row editor (admin/actions-client.tsx, which reflects it
// in the UI) — kept in its own plain module since a "use server" file can
// only export async functions.
export const PROTECTED_ROLE_KEYS = [
  "requestor",
  "logistics_coordinator",
  "logistics_manager",
  "warehouse_team",
  "main_admin",
];
