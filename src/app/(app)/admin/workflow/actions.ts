"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, role_info:roles!profiles_role_fkey(is_manager)")
    .eq("id", user.id)
    .single();

  if (!profile || !(profile.role_info as { is_manager: boolean } | null)?.is_manager) {
    redirect("/dashboard");
  }

  return { supabase, user };
}

function backTo(category: string, error?: string) {
  const base = `/admin/workflow?category=${encodeURIComponent(category)}`;
  return error ? `${base}&error=${encodeURIComponent(error)}` : base;
}

export async function createStage(formData: FormData) {
  const { supabase } = await requireManager();

  const category = formData.get("category") as string;
  const label = (formData.get("label") as string).trim();
  const rawKey = ((formData.get("key") as string) || label).trim();
  const key = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const color = (formData.get("color") as string) || "bg-slate-100 text-slate-700";
  const sortOrder = parseInt((formData.get("sort_order") as string) || "0", 10);
  const isInitial = formData.get("is_initial") === "on";
  const isTerminal = formData.get("is_terminal") === "on";

  if (!key || !label) {
    redirect(backTo(category, "Stage key and label are required"));
  }

  const { error } = await supabase.from("workflow_stages").insert({
    category,
    key,
    label,
    color,
    sort_order: sortOrder,
    is_initial: isInitial,
    is_terminal: isTerminal,
  });

  if (error) {
    redirect(backTo(category, error.message));
  }

  revalidatePath("/admin/workflow");
  updateTag("workflow-stages");
}

export async function updateStage(formData: FormData) {
  const { supabase } = await requireManager();

  const id = formData.get("id") as string;
  const category = formData.get("category") as string;
  const label = (formData.get("label") as string).trim();
  const color = formData.get("color") as string;
  const sortOrder = parseInt((formData.get("sort_order") as string) || "0", 10);
  const isInitial = formData.get("is_initial") === "on";
  const isTerminal = formData.get("is_terminal") === "on";

  const { error } = await supabase
    .from("workflow_stages")
    .update({ label, color, sort_order: sortOrder, is_initial: isInitial, is_terminal: isTerminal })
    .eq("id", id);

  if (error) {
    redirect(backTo(category, error.message));
  }

  revalidatePath("/admin/workflow");
  updateTag("workflow-stages");
}

export async function deleteStage(stageId: string, category: string) {
  const { supabase } = await requireManager();

  const { error } = await supabase.from("workflow_stages").delete().eq("id", stageId);

  if (error) {
    const friendly = /foreign key|violates|constraint/i.test(error.message)
      ? "Can't delete this stage — it's still used by a transition or an existing request."
      : error.message;
    redirect(backTo(category, friendly));
  }

  revalidatePath("/admin/workflow");
  updateTag("workflow-stages");
}

export async function createTransition(formData: FormData) {
  const { supabase } = await requireManager();

  const category = formData.get("category") as string;
  const fromKey = formData.get("from_key") as string;
  const toKey = formData.get("to_key") as string;
  const label = (formData.get("label") as string).trim();
  const variant = (formData.get("variant") as string) || "primary";
  const allowedRoles = formData.getAll("allowed_roles") as string[];
  const sortOrder = parseInt((formData.get("sort_order") as string) || "0", 10);

  if (!fromKey || !toKey || !label) {
    redirect(backTo(category, "From, to, and a button label are required"));
  }

  const { error } = await supabase.from("workflow_transitions").insert({
    category,
    from_key: fromKey,
    to_key: toKey,
    label,
    variant,
    allowed_roles: allowedRoles,
    sort_order: sortOrder,
  });

  if (error) {
    redirect(backTo(category, error.message));
  }

  revalidatePath("/admin/workflow");
}

export async function deleteTransition(transitionId: string, category: string) {
  const { supabase } = await requireManager();

  const { error } = await supabase
    .from("workflow_transitions")
    .delete()
    .eq("id", transitionId);

  if (error) {
    redirect(backTo(category, error.message));
  }

  revalidatePath("/admin/workflow");
}
