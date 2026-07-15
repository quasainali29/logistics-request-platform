"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
    });

    setSubmitting(false);

    // Always show the same success state regardless of whether the email
    // exists — avoids leaking which addresses have accounts.
    if (resetError) {
      setError(resetError.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-3 h-10 w-10 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold">
            L
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Reset your password</h1>
          <p className="text-sm text-slate-500 mt-1">
            We&apos;ll email you a link to set a new one.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          {sent ? (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              If an account exists for that email, a reset link is on its way. Check your inbox.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[var(--accent)] text-white rounded-md py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-slate-500 mt-4">
          <Link href="/login" className="text-[var(--accent)] font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
