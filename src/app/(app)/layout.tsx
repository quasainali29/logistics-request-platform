import { getProfile } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { formatRoleLabel, type AppSettings } from "@/lib/types";
import Link from "next/link";
import {
  LayoutDashboard,
  ClipboardList,
  PlusCircle,
  Warehouse,
  Truck,
  BarChart3,
  Settings,
  UserCircle,
  LogOut,
  Wrench,
} from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  // Nav visibility now reads through the fine-grained permission grid
  // (Admin > Permissions) rather than the coarse is_staff/is_manager flags
  // directly — for the roles seeded today the two agree, but a manager can
  // now grant/revoke each of these independently per role.
  const isManager = !!profile.is_manager;

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", true)
    .single();
  const appSettings = settings as AppSettings | null;
  const orgName = appSettings?.org_name ?? "Logistics Platform";

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/requests", label: "Requests", icon: ClipboardList, show: true },
    { href: "/requests/new", label: "New Request", icon: PlusCircle, show: true },
    { href: "/warehouse", label: "Warehouse", icon: Warehouse, show: can(profile, "view_warehouse") },
    { href: "/fleet", label: "Fleet", icon: Truck, show: can(profile, "view_fleet") },
    { href: "/amc", label: "AMC Contracts", icon: Wrench, show: can(profile, "view_amc") },
    { href: "/reports", label: "Reports", icon: BarChart3, show: can(profile, "view_reports") },
    { href: "/admin", label: "Admin", icon: Settings, show: can(profile, "access_admin_panel") || isManager },
    { href: "/account", label: "My Account", icon: UserCircle, show: true },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-slate-200">
          {appSettings?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={appSettings.logo_url}
              alt={orgName}
              className="h-7 w-7 object-contain rounded-md"
            />
          ) : (
            <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center text-white text-sm font-bold">
              {orgName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-semibold text-sm text-slate-900 truncate">{orgName}</span>
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
            <p className="text-xs text-slate-500">{formatRoleLabel(profile.role)}</p>
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
