// Lightweight CSS-only bar visualization -- no charting library needed for
// simple "compare these counts" views. Renders fine as a Server Component
// since it's just divs sized with inline style widths.
export function BarList({
  items,
  barColor = "var(--accent)",
}: {
  items: { label: string; value: number; sublabel?: string }[];
  barColor?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (items.length === 0) {
    return <p className="text-sm text-slate-400">No data for this range.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm text-slate-700">{item.label}</span>
            <span className="text-sm font-medium text-slate-900">
              {item.value}
              {item.sublabel && <span className="text-slate-400 font-normal"> {item.sublabel}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: barColor }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
