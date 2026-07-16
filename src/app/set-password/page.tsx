"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function establishSession() {
      // Invite / magic-link emails deliver the session as a URL hash
      // fragment (#access_token=...&refresh_token=...) rather than a
      // query `code` — fragments never reach the server (that's why
      // /auth/callback can't see them), and Supabase JS's automatic
      // detectSessionInUrl parsing is async and can race with the
      // getSession() call below. Parse it explicitly here first so we
      // don't depend on that timing.
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (hash && hash.includes("access_token")) {
        const params = new URLSearchParams(hash.slice(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (!setErr) {
            // Strip the tokens out of the visible/sharable URL.
            window.history.replaceState(null, "", window.location.pathname);
            setHasSession(true);
            setChecking(false);
            return;
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
      setChecking(false);
    }

    establishSession();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-3 h-10 w-10 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold">
            L
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Set your password</h1>
          <p className="text-sm text-slate-500 mt-1">
            You've been invited — choose a password to finish setting up your account.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          {checking ? (
            <p className="text-sm text-slate-500 text-center">Checking your invite link…</p>
          ) : !hasSession ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              This link is invalid or has expired. Ask your admin to resend the invite, or{" "}
              <a href="/login" className="underline font-medium">
                sign in
              </a>{" "}
              if you already have a password.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  New password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Confirm password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[var(--accent)] text-white rounded-md py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Set password and continue"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
