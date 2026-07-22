import { signIn, signUp } from "./actions";
import { createClient } from "@/lib/supabase/server";
import type { AppSettings } from "@/lib/types";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const isSignup = params.mode === "signup";

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", true)
    .single();
  const appSettings = settings as AppSettings | null;
  const orgName = appSettings?.org_name ?? "Logistics Request Platform";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-blue-600">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {appSettings?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={appSettings.logo_url}
              alt={orgName}
              className="mx-auto mb-4 h-20 w-20 object-contain rounded-xl"
            />
          ) : (
            <div className="mx-auto mb-4 h-20 w-20 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white font-bold text-3xl shadow-md">
              {orgName.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="text-xl font-semibold text-white">{orgName}</h1>
          <p className="text-sm text-blue-100 mt-1">
            {isSignup ? "Create your account" : "Sign in to continue"}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          {params.message && (
            <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {params.message}
            </div>
          )}
          {params.error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {params.error}
            </div>
          )}

          <form action={isSignup ? signUp : signIn} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Full name
                </label>
                <input
                  name="full_name"
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                name="email"
                type="email"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">
                  Password
                </label>
                {!isSignup && (
                  <Link
                    href="/forgot-password"
                    className="text-xs text-[var(--accent)] font-medium"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <input
                name="password"
                type="password"
                required
                minLength={6}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-[var(--accent)] text-white rounded-md py-2 text-sm font-medium hover:opacity-90 transition"
            >
              {isSignup ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-blue-100 mt-4">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-[var(--accent)] font-medium">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/login?mode=signup" className="text-[var(--accent)] font-medium">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
