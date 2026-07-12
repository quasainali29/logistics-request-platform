import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — server-side only, bypasses RLS. Used for background
// jobs like sending notification emails where we need to look up recipients
// regardless of the acting user's own row-level permissions.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
