import { getProfile } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { getAppSettings } from "@/lib/cachedLookups";
import { formatRoleLabel, type AppSettings } from "@/lib/types";
import AppShell from "./AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const settings = await getAppSettings();
  const appSettings = settings as AppSettings | null;
  const orgName = appSettings?.org_name ?? "Logistics Platform";

  return (
    <AppShell
      orgName={orgName}
      logoUrl={appSettings?.logo_url ?? null}
      fullName={profile.full_name}
      roleLabel={formatRoleLabel(profile.role)}
      permissions={profile.permissions}
      isManager={!!profile.is_manager}
      isTechnician={profile.role === "technician"}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
