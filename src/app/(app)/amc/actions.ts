"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import type { AttachmentFile } from "@/lib/types";

async function requireStaff() {
  const profile = await getProfile();
  if (!profile.is_staff) {
    throw new Error("Only logistics staff can manage AMC contracts.");
  }
  return profile;
}

// Deleting a location or AMC type is manager-only — any staff member can
// add one, but removing one is destructive if it's already in use.
async function requireManager() {
  const profile = await getProfile();
  if (!profile.is_manager) {
    throw new Error("Only managers can delete AMC locations or types.");
  }
  return profile;
}

export async function addAmcLocation(formData: FormData) {
  const profile = await requireStaff();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Location name is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("amc_locations")
    .insert({ name, created_by: profile.id });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`Failed to add location: ${error.message}`);
  }
  revalidatePath("/amc");
}

export async function addAmcType(formData: FormData) {
  const profile = await requireStaff();
  const name = String(formData.get("name") ?? "").trim();
  const requiresCompliance = formData.get("requires_compliance") === "on";
  if (!name) throw new Error("AMC type name is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("amc_types")
    .insert({ name, requires_compliance: requiresCompliance, created_by: profile.id });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`Failed to add AMC type: ${error.message}`);
  }
  revalidatePath("/amc");
}

export async function deleteAmcLocation(locationId: string) {
  await requireManager();
  const supabase = await createClient();

  const { count } = await supabase
    .from("amc_contracts")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId);
  if (count && count > 0) {
    throw new Error(
      "Can't delete a location that still has AMC contracts. Remove or reassign those contracts first."
    );
  }

  const { error } = await supabase.from("amc_locations").delete().eq("id", locationId);
  if (error) {
    throw new Error(`Failed to delete location: ${error.message}`);
  }
  revalidatePath("/amc");
}

export async function deleteAmcType(typeId: string) {
  await requireManager();
  const supabase = await createClient();

  const { count } = await supabase
    .from("amc_contracts")
    .select("id", { count: "exact", head: true })
    .eq("type_id", typeId);
  if (count && count > 0) {
    throw new Error(
      "Can't delete an AMC type that still has contracts. Remove or reassign those contracts first."
    );
  }

  const { error } = await supabase.from("amc_types").delete().eq("id", typeId);
  if (error) {
    throw new Error(`Failed to delete AMC type: ${error.message}`);
  }
  revalidatePath("/amc");
}

export async function createAmcContract(formData: FormData) {
  const profile = await requireStaff();
  const supabase = await createClient();

  const nextMaintenanceDate = String(formData.get("next_maintenance_date") ?? "");
  if (!nextMaintenanceDate) throw new Error("Next maintenance date is required.");

  const { error, data } = await supabase
    .from("amc_contracts")
    .insert({
      location_id: String(formData.get("location_id") ?? ""),
      type_id: String(formData.get("type_id") ?? ""),
      supplier_name: String(formData.get("supplier_name") ?? ""),
      supplier_contact_name: String(formData.get("supplier_contact_name") ?? "") || null,
      supplier_phone: String(formData.get("supplier_phone") ?? "") || null,
      supplier_email: String(formData.get("supplier_email") ?? "") || null,
      frequency_months: Number(formData.get("frequency_months") ?? 3),
      sla_response_hours: formData.get("sla_response_hours")
        ? Number(formData.get("sla_response_hours"))
        : null,
      payment_terms: String(formData.get("payment_terms") ?? "") || null,
      contract_value: formData.get("contract_value")
        ? Number(formData.get("contract_value"))
        : null,
      currency: String(formData.get("currency") ?? "AED"),
      contract_start: String(formData.get("contract_start") ?? "") || null,
      contract_end: String(formData.get("contract_end") ?? "") || null,
      internal_owner_id: String(formData.get("internal_owner_id") ?? "") || profile.id,
      next_maintenance_date: nextMaintenanceDate,
      notes: String(formData.get("notes") ?? "") || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create AMC contract: ${error?.message ?? "unknown error"}`);
  }

  revalidatePath("/amc");
  redirect(`/amc/${data.id}`);
}

export async function updateAmcContract(contractId: string, formData: FormData) {
  await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase
    .from("amc_contracts")
    .update({
      supplier_name: String(formData.get("supplier_name") ?? ""),
      supplier_contact_name: String(formData.get("supplier_contact_name") ?? "") || null,
      supplier_phone: String(formData.get("supplier_phone") ?? "") || null,
      supplier_email: String(formData.get("supplier_email") ?? "") || null,
      frequency_months: Number(formData.get("frequency_months") ?? 3),
      sla_response_hours: formData.get("sla_response_hours")
        ? Number(formData.get("sla_response_hours"))
        : null,
      payment_terms: String(formData.get("payment_terms") ?? "") || null,
      contract_value: formData.get("contract_value")
        ? Number(formData.get("contract_value"))
        : null,
      currency: String(formData.get("currency") ?? "AED"),
      contract_start: String(formData.get("contract_start") ?? "") || null,
      contract_end: String(formData.get("contract_end") ?? "") || null,
      next_maintenance_date: String(formData.get("next_maintenance_date") ?? ""),
      notes: String(formData.get("notes") ?? "") || null,
    })
    .eq("id", contractId);

  if (error) {
    throw new Error(`Failed to update AMC contract: ${error.message}`);
  }

  revalidatePath("/amc");
  revalidatePath(`/amc/${contractId}`);
}

// Report files are uploaded client-side straight to Supabase Storage first
// (see uploadAttachment in src/lib/uploadAttachment.ts) — this action only
// ever receives the resulting public URLs, never raw file bytes, so it
// stays well under the Server Action body-size ceiling even with several
// photos attached.
export async function logAmcMaintenanceVisit(
  contractId: string,
  data: {
    performed_date: string;
    report_files: AttachmentFile[];
    compliance_certificate_no?: string;
    compliance_authority?: string;
    compliance_valid_until?: string;
    notes?: string;
  }
) {
  const profile = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase.from("amc_maintenance_records").insert({
    contract_id: contractId,
    performed_date: data.performed_date,
    report_files: data.report_files,
    compliance_certificate_no: data.compliance_certificate_no || null,
    compliance_authority: data.compliance_authority || null,
    compliance_valid_until: data.compliance_valid_until || null,
    notes: data.notes || null,
    uploaded_by: profile.id,
  });

  if (error) {
    throw new Error(`Failed to log maintenance visit: ${error.message}`);
  }

  revalidatePath("/amc");
  revalidatePath(`/amc/${contractId}`);
}
