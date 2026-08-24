"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Presets are computed against "today" client-side (rather than passed in
// as server-rendered hrefs) so the buttons stay correct across a
// day-boundary without a full page reload, and so highlighting "which
// preset is active" only needs a simple day-count comparison against the
// resolved from/to already in the URL.
const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function DashboardDateFilter({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setRange(newFrom: string, newTo: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("from", newFrom);
    sp.set("to", newTo);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setRange(toIso(start), toIso(end));
  }

  // A preset is "active" only if the current range is exactly today minus
  // (days-1) through today -- a custom range (or a preset picked on a
  // previous day and left stale) simply shows no preset highlighted.
  const todayIso = toIso(new Date());
  const activeDays = (() => {
    for (const p of PRESETS) {
      const start = new Date();
      start.setDate(start.getDate() - (p.days - 1));
      if (from === toIso(start) && to === todayIso) return p.days;
    }
    return null;
  })();

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => applyPreset(p.days)}
          className={`text-xs px-2.5 py-1 rounded-md border ${
            activeDays === p.days
              ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
              : "border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {p.label}
        </button>
      ))}
      <span className="w-px h-4 bg-slate-300 mx-1" />
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => setRange(e.target.value, to)}
        className="border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-700"
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="date"
        value={to}
        min={from}
        max={todayIso}
        onChange={(e) => setRange(from, e.target.value)}
        className="border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-700"
      />
    </div>
  );
}
