import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { ReportsNav } from "./ReportsNav";

const REPORT_CARDS = [
  {
    href: "/reports/throughput",
    permKey: "view_report_throughput",
    title: "Throughput & Status",
    description: "Request volume by category and status, for any date range.",
  },
  {
    href: "/reports/sla",
    permKey: "view_report_sla",
    title: "SLA / Turnaround",
    description: "Average turnaround time per category, plus every request currently overdue.",
  },
  {
    href: "/reports/projects",
    permKey: "view_report_projects",
    title: "Projects",
    description: "Request count and status mix per active project.",
  },
  {
    href: "/reports/amc",
    permKey: "view_report_amc",
    title: "AMC / Compliance",
    description: "Contracts overdue or due soon for maintenance, and compliance certificate status.",
  },
  {
    href: "/reports/coordinator",
    permKey: "view_report_coordinator",
    title: "Coordinator Workload",
    description: "Open and completed requests per owner, with average turnaround.",
  },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile.is_manager && !can(profile, "view_reports")) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const visibleCards = REPORT_CARDS.filter((c) => profile.is_manager || can(profile, c.permKey));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Operational reporting across requests, projects, and AMC contracts.
        </p>
      </div>

      <ReportsNav active="overview" profile={profile} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-3 mb-6">
          {decodeURIComponent(error)}
        </div>
      )}

      {visibleCards.length === 0 ? (
        <p className="text-sm text-slate-400">
          No reports are available to your role yet. Ask an admin to grant access from Admin &gt;
          Permissions.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {visibleCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-[var(--accent)] transition"
            >
              <h2 className="text-sm font-semibold text-slate-900 mb-1">{card.title}</h2>
              <p className="text-xs text-slate-500">{card.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
