import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkflowStage } from "@/lib/types";
import type { AmcLocation, AmcType } from "@/lib/types";

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
