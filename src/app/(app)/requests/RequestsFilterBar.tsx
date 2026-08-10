"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CATEGORY_LABELS } from "@/lib/types";

const PRIORITIES = ["low", "medium", "high", "urgent"];

const DUE_OPTIONS = [
  { value: "", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "next7", label: "Next 7 days" },
  { value: "next30", label: "Next 30 days" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "priority", label: "Priority: high to low" },
  { value: "due", label: "Due date: soonest" },
];

export default function RequestsFilterBar({
  isStaff,
  isCoordinator = false,
  requestorOptions,
  coordinatorOptions,
  technicianOptions,
  statusOptions,
  projectOptions,
}: {
  isStaff: boolean;
  isCoordinator?: boolean;
  requestorOptions: { id: string; full_name: string }[];
  coordinatorOptions: { id: string; full_name: string }[];
  technicianOptions: { id: string; full_name: string }[];
  statusOptions: { value: string; label: string }[];
  projectOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  // Free-text search matches on request number only (e.g. "REQ-00093" or
  // just "93"). Debounced rather than pushed on every keystroke -- each
  // filter change here is a full server navigation, so firing one per
  // character would be both slow and would keep yanking focus/cursor
  // position as the page re-renders mid-type.
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  useEffect(() => {
    setSearch(searchParams.get("search") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsString]);

  useEffect(() => {
    const id = setTimeout(() => {
      const current = searchParams.get("search") ?? "";
      if (search.trim() !== current) update("search", search.trim());
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    // Any filter or sort change starts back at page 1 -- the old page
    // number almost never still makes sense against a different result set.
    sp.delete("page");
    router.push(sp.toString() ? `${pathname}?${sp.toString()}` : pathname);
  }

  const hasFilters = Array.from(searchParams.keys()).some((k) => k !== "page");

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 mb-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Request #"
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[140px]"
          />
        </Field>

        <Field label="From">
          <input
            type="date"
            value={searchParams.get("from") ?? ""}
            onChange={(e) => update("from", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[135px]"
          />
        </Field>

        <Field label="To">
          <input
            type="date"
            value={searchParams.get("to") ?? ""}
            onChange={(e) => update("to", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[135px]"
          />
        </Field>

        <Field label="Category">
          <select
            value={searchParams.get("category") ?? ""}
            onChange={(e) => update("category", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[130px]"
          >
            <option value="">All</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project">
          <select
            value={searchParams.get("project") ?? ""}
            onChange={(e) => update("project", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[150px]"
          >
            <option value="">All</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        {isStaff && (
          <Field label="Requestor">
            <select
              value={searchParams.get("requestor") ?? ""}
              onChange={(e) => update("requestor", e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[150px]"
            >
              <option value="">All</option>
              {requestorOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {isStaff && !isCoordinator && (
          <Field label="Coordinator">
            <select
              value={searchParams.get("coordinator") ?? ""}
              onChange={(e) => update("coordinator", e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[150px]"
            >
              <option value="">All</option>
              {coordinatorOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {isStaff && (
          <Field label="Technician">
            <select
              value={searchParams.get("technician") ?? ""}
              onChange={(e) => update("technician", e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[150px]"
            >
              <option value="">All</option>
              {technicianOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Priority">
          <select
            value={searchParams.get("priority") ?? ""}
            onChange={(e) => update("priority", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[110px]"
          >
            <option value="">All</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status">
          <select
            value={searchParams.get("status") ?? ""}
            onChange={(e) => update("status", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[150px]"
          >
            <option value="">All</option>
            {statusOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due date">
          <select
            value={searchParams.get("due") ?? ""}
            onChange={(e) => update("due", e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[130px]"
          >
            {DUE_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="ml-auto">
          <Field label="Sort by">
            <select
              value={searchParams.get("sort") ?? "newest"}
              onChange={(e) => update("sort", e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-900 w-[180px]"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className="text-sm text-[var(--accent)] font-medium hover:underline pb-1.5"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-slate-500 uppercase">{label}</label>
      {children}
    </div>
  );
}
