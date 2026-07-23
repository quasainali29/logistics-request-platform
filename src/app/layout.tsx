import type { Metadata } from "next";
import "./globals.css";
import { getAppSettings } from "@/lib/cachedLookups";
import type { AppSettings } from "@/lib/types";

async function getSettings(): Promise<AppSettings | null> {
  try {
    const data = await getAppSettings();
    return data as AppSettings | null;
  } catch {
    // Falls back to defaults if the settings table isn't reachable yet
    // (e.g. migration 003 hasn't been run).
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const orgName = settings?.org_name ?? "Logistics Platform";
  return {
    title: `${orgName} — Request Management`,
    description: "Internal logistics request, approval, and resource tracking platform.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSettings();
  const accent = settings?.accent_color ?? "#1f4e78";

  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <body className="min-h-full flex flex-col font-sans bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
