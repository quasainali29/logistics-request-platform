import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { AmcLocation, AmcType } from "@/lib/types";
import { createAmcContract } from "../actions";

export default async function NewAmcPage() {
  const profile = await getProfile();
  if (!profile.is_staff) redirect("/amc");

  const supabase = await createClient();
  const [{ data: locations }, { data: types }, { data: staffProfiles }] = await Promise.all([
    supabase.from("amc_locations").select("*").order("name"),
    supabase.from("amc_types").select("*").order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, role_info:roles!profiles_role_fkey(is_staff)")
      .eq("status", "active"),
  ]);

  const locationList = (locations ?? []) as AmcLocation[];
  const typeList = (types ?? []) as AmcType[];
  const staffList = ((staffProfiles ?? []) as unknown as {
    id: string;
    full_name: string;
    role_info: { is_staff: boolean } | null;
  }[])
    .filter((p) => p.role_info?.is_staff)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Add AMC contract</h1>
        <p className="text-sm text-slate-500 mt-1">
          Set up a new annual maintenance contract for a location and AMC type.
        </p>
      </div>

      <form
        action={createAmcContract}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location">
            <select
              name="location_id"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select location</option>
              {locationList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="AMC type">
            <select
              name="type_id"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select AMC type</option>
              {typeList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Supplier name">
            <input
              name="supplier_name"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Supplier contact person">
            <input
              name="supplier_contact_name"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Supplier phone">
            <input
              name="supplier_phone"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Supplier email">
            <input
              type="email"
              name="supplier_email"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Frequency">
            <select
              name="frequency_months"
              defaultValue="3"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="1">Monthly</option>
              <option value="2">Every 2 months</option>
              <option value="3">Quarterly</option>
              <option value="6">Bi-annual</option>
              <option value="12">Annual</option>
            </select>
          </Field>
          <Field label="Next maintenance date">
            <input
              type="date"
              name="next_maintenance_date"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="SLA response time (hours)">
            <input
              type="number"
              min={0}
              name="sla_response_hours"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Contract start">
            <input
              type="date"
              name="contract_start"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Contract end">
            <input
              type="date"
              name="contract_end"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Internal owner">
            <select
              name="internal_owner_id"
              defaultValue={profile.id}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Contract value">
            <input
              type="number"
              step="0.01"
              min={0}
              name="contract_value"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Currency">
            <input
              name="currency"
              defaultValue="AED"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <Field label="Payment terms">
          <input
            name="payment_terms"
            placeholder="e.g. 50% advance, 50% on completion"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Notes">
          <textarea
            name="notes"
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>

        <button
          type="submit"
          className="rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition"
        >
          Create AMC contract
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
