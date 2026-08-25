// Shared KPI card building blocks -- originally built for the coordinator
// and technician dashboards (src/app/(app)/dashboard/page.tsx), extracted
// here so the new Logistics Performance report (src/app/(app)/reports/
// performance/page.tsx) can render the exact same cards for its org-wide
// "Overall" view without duplicating the SVG/markup and risking visual
// drift between the two pages. The dashboard imports these too instead of
// keeping its own copies.

export const CATEGORIES_ORDER = ["delivery", "labor", "maintenance", "procurement"] as const;
export const PRIORITIES_ORDER = ["low", "medium", "high", "urgent"] as const;
export const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Priority bars reuse the same hue family as PRIORITY_COLORS elsewhere in
// the app (slate/blue/orange/red) at a stronger, bar-visible saturation.
// Category bars use a distinct set of hues so the two mix cards never look
// like they're encoding the same thing when shown side by side.
export const PRIORITY_PALETTE: Record<string, string> = {
  low: "bg-slate-300",
  medium: "bg-blue-400",
  high: "bg-orange-400",
  urgent: "bg-red-400",
};
export const CATEGORY_PALETTE: Record<string, string> = {
  delivery: "bg-indigo-400",
  labor: "bg-teal-400",
  maintenance: "bg-amber-400",
  procurement: "bg-pink-400",
};

export function DonutCard({
  title,
  total,
  completedCount,
  pendingCount,
}: {
  title: string;
  total: number;
  completedCount: number;
  pendingCount: number;
}) {
  const r = 32;
  const circumference = 2 * Math.PI * r;
  const completedLen = total > 0 ? circumference * (completedCount / total) : 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <div className="flex items-center gap-4">
        <div className="relative w-[72px] h-[72px] shrink-0">
          <svg width="72" height="72" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={r} fill="none" stroke="#fde68a" strokeWidth="9" />
            {total > 0 && (
              <circle
                cx="38"
                cy="38"
                r={r}
                fill="none"
                stroke="#10b981"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${completedLen} ${circumference}`}
                transform="rotate(-90 38 38)"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900">
            {total}
          </div>
        </div>
        <div className="text-xs text-slate-600 space-y-1.5">
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {completedCount} completed
          </p>
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />
            {pendingCount} pending
          </p>
        </div>
      </div>
    </div>
  );
}

export function SlaScoreCard({ score, sublabel }: { score: number | null; sublabel: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">SLA score</p>
      <p className="text-2xl font-semibold text-slate-900 mb-2">{score !== null ? `${score}%` : "—"}</p>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">{sublabel}</p>
    </div>
  );
}

export function PerformanceRingCard({
  title,
  value,
  sublabel,
}: {
  title: string;
  value: number | null;
  sublabel: string;
}) {
  const r = 32;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - (value ?? 0) / 100);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <div className="flex items-center gap-4">
        <div className="relative w-[72px] h-[72px] shrink-0">
          <svg width="72" height="72" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={r} fill="none" stroke="#e2e8f0" strokeWidth="9" />
            {value !== null && (
              <circle
                cx="38"
                cy="38"
                r={r}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 38 38)"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900">
            {value !== null ? `${value}%` : "—"}
          </div>
        </div>
        <p className="text-xs text-slate-400">{value !== null ? sublabel : "Not enough data yet."}</p>
      </div>
    </div>
  );
}

export function StatCard2({
  title,
  value,
  unit,
  sublabel,
}: {
  title: string;
  value: number | null;
  unit: string;
  sublabel: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <p className="text-2xl font-semibold text-slate-900 mb-2">
        {value !== null ? value : "—"} <span className="text-sm font-normal text-slate-500">{unit}</span>
      </p>
      <p className="text-xs text-slate-400">{sublabel}</p>
    </div>
  );
}

export function PercentCard({
  title,
  value,
  sublabel,
  danger,
}: {
  title: string;
  value: number | null;
  sublabel: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <p className="text-2xl font-semibold text-slate-900 mb-2">{value !== null ? `${value}%` : "—"}</p>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${danger ? "bg-red-400" : "bg-emerald-500"}`}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">{sublabel}</p>
    </div>
  );
}

export function MixCard({
  title,
  segments,
  palette,
}: {
  title: string;
  segments: { key: string; label: string; count: number }[];
  palette: Record<string, string>;
}) {
  const total = segments.reduce((a, b) => a + b.count, 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      <div className="h-2.5 rounded-full overflow-hidden flex mb-3 bg-slate-100">
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              className={palette[s.key] ?? "bg-slate-300"}
              style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%` }}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-slate-600">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${palette[s.key] ?? "bg-slate-300"}`} />
            {s.label} {s.count}
          </span>
        ))}
      </div>
    </div>
  );
}

// Scores one item's turnaround against its own promised window. A job/
// request that closes at or before the due date scores 100; one that
// overruns scores target/actual, which naturally handles actualDays <= 0
// or targetDays <= 0 edge cases without special-casing them. Shared by the
// dashboard's per-role SLA score and the performance report's org-wide and
// per-person SLA scores so the methodology never drifts between the two.
export function scoreTurnaround(actualDays: number, targetDays: number): number {
  return actualDays <= 0 || actualDays <= targetDays
    ? 100
    : Math.max(0, Math.min(100, (targetDays / actualDays) * 100));
}

// 70% completion rate + 30% SLA score (falling back to completion rate
// itself if there's no SLA data yet), gated behind a minimum cohort size
// so a single request/job doesn't swing the number from 0% to 100%.
export function overallPerformanceScore(
  cohortSize: number,
  completionRate: number | null,
  slaScore: number | null
): number | null {
  if (cohortSize < 3 || completionRate === null) return null;
  return Math.round(0.7 * completionRate * 100 + 0.3 * (slaScore ?? completionRate * 100));
}
