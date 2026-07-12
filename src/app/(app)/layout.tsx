import { getProfile } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { ROLE_LABELS } from "@/lib/types";
import Link from "next/link";
import {
  LayoutDashboard,
  ClipboardList,
  PlusCircle,
  Warehouse,
  Truck,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const isStaff = profile.role !== "requestor";
  const isManager = profile.role === "logistics_manager";

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/requests", label: "Requests", icon: ClipboardList, show: true },
    { href: "/requests/new", label: "New Request", icon: PlusCircle, show: true },
    { href: "/warehouse", label: "Warehouse", icon: Warehouse, show: isStaff },
    { href: "/fleet", label: "Fleet", icon: Truck, show: isStaff },
    { href: "/reports", label: "Reports", icon: BarChart3, show: isStaff },
    { href: "/admin", label: "Admin", icon: Settings, show: isManager },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-slate-200">
          <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center text-white text-sm font-bold">
            L
          </div>
          <span className="font-semibold text-sm text-slate-900">
            Logistics Platform
          </span>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems
            .filter((i) => i.show)
            .map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-700 hover:bg-slate-100 transition"
                >
                  <Icon size={17} strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-slate-900 truncate">
              {profile.full_name}
            </p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[profile.role]}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-500 hover:bg-slate-100 transition"
            >
              <LogOut size={17} strokeWidth={1.75} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0 bg-slate-50">{children}</main>
    </div>
  );
}
