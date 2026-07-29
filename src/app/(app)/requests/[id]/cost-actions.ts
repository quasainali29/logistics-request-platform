"use server";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

// Cost lines are entered by the coordinator at closeout (see the "Cost
// incurred" section of CloseoutForm.tsx, handled by
// closeRequestWithDocuments in ../actions.ts) — this file covers the
// second half of that workflow: a manager adjusting those lines
// afterward, from the request detail page (CostBreakdownManager.tsx).
async function requireManager(supabase: SupabaseClient, requestId: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role_info:roles!profiles_role_fkey(is_manager)")
    .eq("id", user.id)
    .single();

  const isManager = !!(profile?.role_info as { is_manager: boolean } | null)?.is_manager;
  if (!isManager) {
    redirect(
      `/requests/${requestId}?error=${encodeURIComponent(
        "Only managers can adjust cost lines."
      )}`
    );
  }

  return user.id;
}

export async function addCostLine(requestId: string, formData: FormData) {
  const supabase = await createClient();
  const userId = await requireManager(supabase, requestId);

  const category = ((formData.get("cost_category") as string) || "other").trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const amount = parseFloat(formData.get("amount") as string) || 0;

  const validCategories = new Set(["materials", "labor", "transport", "other"]);
  const costCategory = validCategories.has(category) ? category : "other";

  if (amount > 0) {
    await supabase.from("request_cost_lines").insert({
      request_id: requestId,
      cost_category: costCategory,
      description,
      amount,
      added_by: userId,
    });
  }

  revalidatePath(`/requests/${requestId}`);
}

export async function deleteCostLine(lineId: string, requestId: string) {
  const supabase = await createClient();
  await requireManager(supabase, requestId);

  await supabase.from("request_cost_lines").delete().eq("id", lineId).eq("request_id", requestId);

  revalidatePath(`/requests/${requestId}`);
}
