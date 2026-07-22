import Link from "next/link";

export function AdminNav({
  active,
}: {
  active: "users" | "permissions" | "workflow" | "branding";
}) {
  const tabs = [
    { key: "users", href: "/admin", label: "Users & Roles" },
    { key: "permissions", href: "/admin/permissions", label: "Permissions" },
    { key: "workflow", href: "/admin/workflow", label: "Workflow" },
    { key: "branding", href: "/admin/branding", label: "Branding" },
  ] as const;

  return (
    <div className="flex gap-1 border-b border-slate-200 mb-6">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
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
