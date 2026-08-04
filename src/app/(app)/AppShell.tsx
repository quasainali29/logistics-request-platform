"use client";

import { useState } from "react";
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
  Menu,
  X,
} from "lucide-react";

interface AppShellProps {
  orgName: string;
  logoUrl: string | null;
  fullName: string;
  roleLabel: string;
  permissions: string[];
  isManager: boolean;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

// Responsive app shell: a persistent sidebar on desktop (lg+), collapsing
// into a hamburger-triggered drawer on smaller screens. Nav items, icons,
// and permission gating are unchanged from the previous fixed-sidebar
// layout -- only the responsive behavior is new.
export default function AppShell({
  orgName,
  logoUrl,
  fullName,
  roleLabel,
  permissions,
  isManager,
  signOutAction,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);

  const can = (key: string) => permissions.includes(key);

  const navItems = [
    { href: "/requests/new", label: "New Request", icon: PlusCircle, show: true },
    { href: "/requests", label: "Requests", icon: ClipboardList, show: true },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/amc", label: "AMC Contracts", icon: Wrench, show: can("view_amc") },
    { href: "/reports", label: "Reports", icon: BarChart3, show: can("view_reports") },
    { href: "/warehouse", label: "Warehouse", icon: Warehouse, show: can("view_warehouse") },
    { href: "/fleet", label: "Fleet", icon: Truck, show: can("view_fleet") },
    {
      href: "/admin",
      label: "Admin",
      icon: Settings,
      show: can("access_admin_panel") || isManager,
    },
    { href: "/account", label: "My Account", icon: UserCircle, show: true },
  ].filter((i) => i.show);

  const logo = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt={orgName} className="h-7 w-7 object-contain rounded-md shrink-0" />
  ) : (
    <div className="h-7 w-7 rounded-md bg-[var(--accent)] flex items-center justify-center text-white text-sm font-bold shrink-0">
      {orgName.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile top bar -- hidden on desktop, where the sidebar is always visible */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-3 border-b border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-2 rounded-md text-slate-600 hover:bg-slate-100 active:bg-slate-200"
        >
          <Menu size={22} strokeWidth={1.75} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {logo}
          <span className="font-semibold text-sm text-slate-900 truncate max-w-[160px]">
            {orgName}
          </span>
        </div>
        <div className="w-9" aria-hidden="true" />
      </div>

      {/* Backdrop, mobile drawer only */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: slide-in drawer on mobile, static column on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] shrink-0 border-r border-slate-200 bg-white flex flex-col transform transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:w-60 lg:max-w-none lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-16 flex items-center justify-between gap-2 px-5 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            {logo}
            <span className="font-semibold text-sm text-slate-900 truncate">{orgName}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="lg:hidden p-1.5 rounded-md text-slate-400 hover:bg-slate-100"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 lg:py-2 rounded-md text-sm text-slate-700 hover:bg-slate-100 transition"
              >
                <Icon size={17} strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-slate-900 truncate">{fullName}</p>
            <p className="text-xs text-slate-500">{roleLabel}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2.5 lg:py-2 rounded-md text-sm text-slate-500 hover:bg-slate-100 transition"
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
