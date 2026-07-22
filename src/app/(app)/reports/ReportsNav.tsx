import Link from "next/link";
import type { Profile } from "@/lib/types";
import { can } from "@/lib/permissions";

const TABS = [
  { key: "overview", href: "/reports", label: "Overview", permKey: null },
  { key: "throughput", href: "/reports/throughput", label: "Throughput & Status", permKey: "view_report_throughput" },
  { key: "sla", href: "/reports/sla", label: "SLA / Turnaround", permKey: "view_report_sla" },
  { key: "projects", href: "/reports/projects", label: "Projects", permKey: "view_report_projects" },
  { key: "amc", href: "/reports/amc", label: "AMC / Compliance", permKey: "view_report_amc" },
  { key: "coordinator", href: "/reports/coordinator", label: "Coordinator Workload", permKey: "view_report_coordinator" },
] as const;

export function ReportsNav({ active, profile }: { active: string; profile: Profile }) {
  const visible = TABS.filter((t) => !t.permKey || profile.is_manager || can(profile, t.permKey));

  return (
    <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
      {visible.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
            active === t.key
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
