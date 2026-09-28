import type { SupabaseClient } from "@supabase/supabase-js";

// The three sub-states a "completed" request can be in on the Requests
// list -- shared between the list page's status filter/derivation and
// RequestsTable's display. Mirrors the currentVerification logic on the
// request detail page (src/app/(app)/requests/[id]/page.tsx): a
// verification only counts toward the CURRENT completion cycle if it was
// logged at or after the technician's latest signature, otherwise it's a
// stale "not satisfactory" left over from before a rework loop -- which
// resets the bucket back to "waiting_verification" for the new cycle
// without needing to delete/archive the old verification row.
export type CompletedVerificationBucket = "waiting_verification" | "require_recheck" | "verified";

export const VERIFICATION_BUCKET_LABELS: Record<CompletedVerificationBucket, string> = {
  waiting_verification: "Waiting for verification",
  require_recheck: "Require recheck",
  verified: "Verified",
};

export const VERIFICATION_BUCKET_COLORS: Record<CompletedVerificationBucket, string> = {
  waiting_verification: "bg-slate-100 text-slate-600",
  require_recheck: "bg-red-100 text-red-700",
  verified: "bg-emerald-100 text-emerald-800",
};

export async function computeCompletedVerificationBuckets(
  supabase: SupabaseClient,
  completedRequestIds: string[]
): Promise<Map<string, CompletedVerificationBucket>> {
  const result = new Map<string, CompletedVerificationBucket>();
  if (completedRequestIds.length === 0) return result;

  const [{ data: verifications }, { data: closeouts }] = await Promise.all([
    supabase
      .from("request_verifications")
      .select("request_id, decision, created_at")
      .in("request_id", completedRequestIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("request_closeouts")
      .select("request_id, signed_at")
      .in("request_id", completedRequestIds),
  ]);

  const closeoutByRequest = new Map<string, string | null>(
    (closeouts ?? []).map((c: any) => [c.request_id as string, c.signed_at as string | null])
  );
  const latestByRequest = new Map<string, { decision: string; created_at: string }>();
  for (const v of (verifications ?? []) as any[]) {
    if (!latestByRequest.has(v.request_id)) {
      latestByRequest.set(v.request_id, { decision: v.decision, created_at: v.created_at });
    }
  }

  for (const id of completedRequestIds) {
    const signedAt = closeoutByRequest.get(id) ?? null;
    const v = latestByRequest.get(id);
    const isCurrent = !!v && (!signedAt || v.created_at >= signedAt);
    if (!isCurrent) {
      result.set(id, "waiting_verification");
    } else if (v!.decision === "not_satisfactory") {
      result.set(id, "require_recheck");
    } else {
      result.set(id, "verified");
    }
  }
  return result;
}
