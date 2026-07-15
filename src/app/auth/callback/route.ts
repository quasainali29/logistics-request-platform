import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase's invite / password-reset / magic-link emails use the PKCE flow:
// the link redirects here with a one-time `?code=` param that must be
// exchanged for a real session (which sets the auth cookies) before the user
// can land on a page like /set-password. Without this step, /set-password's
// client-side getSession() call always finds nothing and shows "invalid or
// expired" even for a brand-new link.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/set-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or the exchange genuinely failed (link already used, or truly
  // expired) — send them to set-password, which will show the
  // invalid/expired message since no session exists.
  return NextResponse.redirect(`${origin}/set-password`);
}
