"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  amcContractStatus,
  amcDueStatus,
  frequencyLabel,
  AMC_DUE_STATUS_COLORS,
  AMC_DUE_STATUS_LABELS,
  AMC_CONTRACT_STATUS_COLORS,
  AMC_CONTRACT_STATUS_LABELS,
  type AmcContract,
  type AmcLocation,
  type AmcType,
} from "@/lib/types";

export default function AmcTable({
  contracts,
  locations,
  types,
}: {
  contracts: AmcContract[];
  locations: AmcLocation[];
  types: AmcType[];
}) {
  const [locationFilter, setLocationFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return contracts.filter((c) => {
      if (locationFilter !== "all" && c.location_id !== locationFilter) return false;
      if (typeFilter !== "all" && c.type_id !== typeFilter) return false;
      if (statusFilter !== "all" && amcDueStatus(c.next_maintenance_date) !== statusFilter)
        return false;
      return true;
    });
  }, [contracts, locationFilter, typeFilter, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="all">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="all">All AMC types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due soon</option>
          <option value="upcoming">Upcoming</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Location</th>
              <th className="text-left px-4 py-3 font-medium">AMC type</th>
              <th className="text-left px-4 py-3 font-medium">Supplier</th>
              <th className="text-left px-4 py-3 font-medium">Schedule</th>
              <th className="text-left px-4 py-3 font-medium">Next maintenance</th>
              <th className="text-left px-4 py-3 font-medium">Contract</th>
              <th className="text-left px-4 py-3 font-medium">Payment terms</th>
              <th className="text-left px-4 py-3 font-medium">Report</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No AMC contracts match these filters.
                </td>
              </tr>
            )}
            {filtered.map((c) => {
              const due = amcDueStatus(c.next_maintenance_date);
              const contractStatus = amcContractStatus(c.contract_end);
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/amc/${c.id}`} className="text-slate-900 hover:underline">
                      {c.location?.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{c.type?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{c.supplier_name}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {frequencyLabel(c.frequency_months)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs mr-2 ${AMC_DUE_STATUS_COLORS[due]}`}
                    >
                      {AMC_DUE_STATUS_LABELS[due]}
                    </span>
                    {format(parseISO(c.next_maintenance_date), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs ${AMC_CONTRACT_STATUS_COLORS[contractStatus]}`}
                    >
                      {AMC_CONTRACT_STATUS_LABELS[contractStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{c.payment_terms ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/amc/${c.id}#upload`}
                      className="text-xs text-[var(--accent)] underline whitespace-nowrap"
                    >
                      Upload
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
