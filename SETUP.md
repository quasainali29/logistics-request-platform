# Setup Guide — Logistics Request Management Platform

This app is fully built and compiles cleanly. It needs three free accounts
connected before it goes live. None of these require a credit card at this
scale.

## 1. Supabase (database + login system) — supabase.com

1. Sign up free at supabase.com, create a new project (pick any name/region,
   set a database password and save it somewhere safe).
2. Once the project is ready, go to **SQL Editor → New query**, paste the
   entire contents of `supabase/schema.sql` from this project, and click Run.
   This creates all 13 tables, the login-role wiring, and the double-booking
   prevention rule.
3. Go to **Project Settings → API**. You'll need three values from this page:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key (click "reveal") → `SUPABASE_SERVICE_ROLE_KEY`
     (keep this one secret — it bypasses login permissions, used only for
     the automated email job)

## 2. Resend (automated emails) — resend.com

1. Sign up free (100 emails/day, 3,000/month — plenty at this scale).
2. Go to **API Keys → Create API Key**, copy it → `RESEND_API_KEY`.
3. Emails will send from Resend's shared test address until you verify your
   own domain under **Domains** (optional, can do later).

## 3. Vercel (hosting) — vercel.com

1. Sign up free (sign in with GitHub is easiest).
2. Once your Vercel account exists, share access with me (or paste a
   deployment token) and I'll handle the actual deploy — pushing the code,
   setting environment variables, and configuring the daily email digest.

## Environment variables needed at deploy time

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_APP_URL=          (filled in automatically once deployed)
CRON_SECRET=                  (any random string, protects the daily email job)
```

## After first deploy

- Create your own account on the live site (Sign up), then in Supabase go to
  **Table Editor → profiles**, find your row, and change `role` from
  `requestor` to `logistics_manager` — this is how the very first admin
  account gets promoted. After that, you can manage roles the same way.
- Everyone else signs up the same way and starts as a Requestor until
  promoted.
