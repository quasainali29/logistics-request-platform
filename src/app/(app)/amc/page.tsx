import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  amcContractStatus,
  amcDueStatus,
  type AmcContract,
} from "@/lib/types";
import { addAmcLocation, addAmcType, deleteAmcLocation, deleteAmcType } from "./actions";
import { getAmcLocations, getAmcTypes } from "@/lib/cachedLookups";
import { X } from "lucide-react";
import AmcTable from "./AmcTable";

export default async function AmcPage() {
  const profile = await getProfile();
  const isStaff = !!profile.is_staff;
  const isManager = !!profile.is_manager;
  const supabase = await createClient();

  const [locationList, typeList, { data: contracts }] = await Promise.all([
    getAmcLocations(),
    getAmcTypes(),
    supabase
      .from("amc_contracts")
      .select(
        "*, location:amc_locations(*), type:amc_types(*), internal_owner:profiles!amc_contracts_internal_owner_id_fkey(full_name)"
      )
      .order("next_maintenance_date"),
  ]);

  const contractList = (contracts ?? []) as AmcContract[];

  const overdueCount = contractList.filter(
    (c) => amcDueStatus(c.next_maintenance_date) === "overdue"
  ).length;
  const dueSoonCount = contractList.filter(
    (c) => amcDueStatus(c.next_maintenance_date) === "due_soon"
  ).length;
  const underRenewalCount = contractList.filter(
    (c) => amcContractStatus(c.contract_end) === "under_renewal"
  ).length;
  const supplierCount = new Set(contractList.map((c) => c.supplier_name.trim().toLowerCase()))
    .size;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">AMC contracts</h1>
          <p className="text-sm text-slate-500 mt-1">
            Annual maintenance contracts across every location.
          </p>
        </div>
        {isStaff && (
          <Link
            href="/amc/new"
            className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
          >
            Add AMC
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Total AMCs" value={contractList.length} />
        <MetricCard label="Overdue" value={overdueCount} tone="danger" />
        <MetricCard label="Due within 30 days" value={dueSoonCount} tone="warning" />
        <MetricCard label="Under renewal" value={underRenewalCount} tone="warning" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Locations</p>
          <div className="flex flex-wrap gap-2 items-center">
            {locationList.map((loc) => (
              <span
                key={loc.id}
                className="relative group bg-slate-100 text-slate-700 rounded-md px-3 py-1.5 text-xs"
              >
                {loc.name}
                {isManager && (
                  <form
                    action={deleteAmcLocation.bind(null, loc.id)}
                    className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition"
                  >
                    <button
                      type="submit"
                      aria-label={`Delete ${loc.name}`}
                      className="w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </form>
                )}
              </span>
            ))}
            {isStaff && (
              <details className="relative">
                <summary className="list-none cursor-pointer bg-white border border-dashed border-slate-300 text-slate-500 rounded-md px-3 py-1.5 text-xs hover:border-slate-400">
                  + Add location
                </summary>
                <form
                  action={addAmcLocation}
                  className="absolute z-10 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg p-3 flex gap-2 w-64"
                >
                  <input
                    name="name"
                    required
                    placeholder="Location name"
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    className="bg-[var(--accent)] text-white rounded-md px-2.5 py-1.5 text-xs font-medium"
                  >
                    Add
                  </button>
                </form>
              </details>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">AMC types</p>
          <div className="flex flex-wrap gap-2 items-center">
            {typeList.map((t) => (
              <span
                key={t.id}
                className="relative group bg-slate-100 text-slate-700 rounded-md px-3 py-1.5 text-xs"
              >
                {t.name}
                {isManager && (
                  <form
                    action={deleteAmcType.bind(null, t.id)}
                    className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition"
                  >
                    <button
                      type="submit"
                      aria-label={`Delete ${t.name}`}
                      className="w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </form>
                )}
              </span>
            ))}
            {isStaff && (
              <details className="relative">
                <summary className="list-none cursor-pointer bg-white border border-dashed border-slate-300 text-slate-500 rounded-md px-3 py-1.5 text-xs hover:border-slate-400">
                  + Add AMC type
                </summary>
                <form
                  action={addAmcType}
                  className="absolute z-10 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg p-3 flex flex-col gap-2 w-72"
                >
                  <input
                    name="name"
                    required
                    placeholder="AMC type name"
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" name="requires_compliance" className="rounded border-slate-300" />
                    Requires compliance certificate per visit
                  </label>
                  <button
                    type="submit"
                    className="bg-[var(--accent)] text-white rounded-md px-2.5 py-1.5 text-xs font-medium self-start"
                  >
                    Add
                  </button>
                </form>
              </details>
            )}
          </div>
        </div>
      </div>

      <AmcTable
        contracts={contractList}
        locations={locationList}
        types={typeList}
      />

      <p className="text-xs text-slate-400 mt-3">{supplierCount} active supplier{supplierCount === 1 ? "" : "s"}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning";
}) {
  const toneClass =
    tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
