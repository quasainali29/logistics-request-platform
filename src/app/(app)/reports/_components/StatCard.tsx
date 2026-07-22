export function StatCard({
  label,
  value,
  tone = "default",
  caption,
  compact = false,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "danger";
  caption?: string;
  compact?: boolean;
}) {
  const valueColor =
    tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-slate-900";
  const valueSize = compact ? "text-lg" : "text-2xl";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`${valueSize} font-semibold ${valueColor}`}>{value}</p>
      {caption && <p className="text-xs text-slate-400 mt-1">{caption}</p>}
    </div>
  );
}
