# ApplySignal AI

A React + TypeScript + Vite career-management app using Supabase Auth, PostgreSQL with Row Level Security, Supabase Edge Functions for AI and scheduled email reminders, optional Gmail read-only import, and browser-side resume extraction/OCR.

## 1. Local setup

```bash
npm ci
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. The app usually opens at `http://localhost:5173`. Without valid Supabase values, the app shows a setup screen and does not fake a login or save data locally.

## 2. Supabase database

### Why you saw "Could not find the table 'public.applications' in the schema cache"

That message means the Supabase Data API (PostgREST) cannot see the table. There are two real causes, and both must be ruled out:

1. **The SQL was never run** (the table does not exist), or
2. **The table exists but has no GRANTs.** Supabase stopped auto-exposing new `public` tables to the Data API for new projects (default since 2026-05-30) and enforces it on all existing projects from **2026-10-30**. Tables now need explicit `GRANT`s. Migration `006_data_api_grants.sql` (also included in `schema.sql`) adds them; Row Level Security still controls which rows each user can see.

Check which case you are in (Supabase → SQL Editor → New query):

```sql
-- 1) Do the tables exist?  (expect 8 rows after setup)
select tablename from pg_tables where schemaname = 'public' order by 1;

-- 2) Can the API roles use them?  (expect authenticated: DELETE, INSERT, SELECT, UPDATE; no anon rows)
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'applications'
  and grantee in ('anon','authenticated','service_role') order by 2, 3;
```

If step 1 returns nothing, run the SQL below. If step 1 lists the tables but step 2 has no `authenticated` rows, run only `supabase/migrations/006_data_api_grants.sql`. After either, run `notify pgrst, 'reload schema';` in the SQL Editor (or Project Settings → API → reload schema) and refresh the app.

### Fresh, empty Supabase project (this is the case if the table list above is empty)

Run **only** `supabase/schema.sql`, once, in the Supabase SQL Editor. It contains the full current schema, migrations 003–006 and the grants. Do **not** also run the files in `supabase/migrations/`, and do **not** use `supabase db push` on a fresh project (the numbered migrations are upgrade steps that assume the older tables already exist).

### Existing project created from an earlier ApplySignal AI schema

Back up the database first. Apply each missing migration exactly once, in this order:

1. `002_ownership.sql` — composite ownership foreign keys and RLS.
2. `003_ai_profile.sql` — AI metadata, profiles, and server-only AI usage ledger.
3. `004_quota_dismissals.sql` — persistent reminder dismissals and atomic AI quota function.
4. `005_notifications_realtime.sql` — email preference/timezone, private notification-delivery ledger, and Realtime publication membership.
5. `006_data_api_grants.sql` — explicit Data API privileges (needed by every project from 2026-10-30; safe to run on a project that already works).

If migration 002 was already applied, do not rerun it unless you have confirmed the current schema is compatible. Migrations are additive/idempotent, but a backup is still recommended. `npm run test:db` uses uniquely named throwaway local databases and cleans up only the databases it created.

### Authentication setup

In Supabase Authentication settings:
- Enable the Email provider.
- Set Site URL to your local app origin while developing.
- Add `http://localhost:5173/reset` to allowed redirect URLs and add the production reset URL after deployment.
- Email confirmation can be enabled; if enabled, users must verify their email before signing in.

Profiles are **not** created by a signup trigger: the row is created the first time you press *Save profile*, and the app treats a missing row as normal (defaults shown, no error).

Use **Authentication → Users** to inspect registered accounts. Use **Table Editor** to inspect `applications`, `opportunities`, `skill_analyses`, `learning_tasks`, and `profiles`. `ai_usage` and `notification_deliveries` are server-only ledgers and intentionally have no client RLS policies.

## 3. AI provider setup (server-side only)

The browser calls `supabase/functions/ai/index.ts`; the private AI API key is never put in a `VITE_` variable.

1. Install the Supabase CLI and link the project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
2. Set the AI provider secrets. Example for Gemini:
   ```bash
   supabase secrets set AI_PROVIDER=gemini AI_API_KEY=YOUR_PRIVATE_KEY AI_MODEL=YOUR_SUPPORTED_MODEL_ID APP_ORIGIN=http://localhost:5173
   ```
   For OpenAI, use `AI_PROVIDER=openai` and a model available to your account. Use the deployed website origin for `APP_ORIGIN` in production. Do not put the secret key in `.env`, source files, or GitHub.
3. Deploy:
   ```bash
   supabase functions deploy ai
   ```
4. Test Opportunity Radar and SkillMap while signed in. Provider availability, billing, model access, CORS, and database quota setup must all be correct for live requests to succeed.

The Edge Function validates the caller's Supabase session, input size, and atomic per-user hourly quota. The frontend validates AI output before showing or saving it. AI content can still be wrong; review extracted values.

## 4. Resume extraction and OCR

PDF/DOCX files up to 5 MB are read in the browser. Text extraction uses PDF.js and Mammoth. If a PDF has no text layer, the app can optionally run OCR for up to five pages using Tesseract.js and the English language model. OCR runs in the browser; the document itself is not uploaded to the OCR provider. The browser downloads the OCR engine from jsDelivr and the language model from Tesseract's configured model host, so internet access is needed. Review OCR text carefully. Only text you explicitly submit for AI analysis is sent to the configured AI provider after consent.

The first ten PDF pages and 15,000 extracted characters are used. DOCX images are not OCR-processed.

## 5. Gmail import (optional, read-only)

Opportunity Radar supports explicit Gmail import for up to ten recent matching messages from the last 30 days. It does not scan Gmail in the background and does not automatically send email contents to AI. You choose an email and then choose whether to analyze it.

To enable it:
1. In Google Cloud Console, enable the Gmail API and create an OAuth 2.0 **Web application** client ID.
2. Add `http://localhost:5173` as an authorized JavaScript origin (and your production origin after deployment).
3. Configure the OAuth consent screen and the Gmail read-only scope `https://www.googleapis.com/auth/gmail.readonly`.
4. Add the public client ID to `.env` as `VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID`, then restart Vite.

The OAuth client ID is public configuration, not a secret. Gmail access tokens are kept in memory only. Google may require consent-screen testing/verification depending on your account and deployment. If Gmail is not configured, CSV/JSON import and pasted text remain available.

## 6. CSV/JSON opportunity import

Opportunity Radar accepts `.csv` or `.json` files up to 2 MB and 200 rows. CSV headers should include `company` and `role` (or recognized equivalents such as `organization` and `title`). Optional columns include `type`, `url`, `deadline`, `assessment_date`, `interview_date`, `source`, and `description`. Rows are previewed and selected before they are saved. Dates must be valid `YYYY-MM-DD` values.

## 7. Email reminder delivery (optional)

The app can send a daily email digest for reminders due today through the next three days. Email reminders are opt-in under Profile settings. Delivery requires a Resend account with a verified sender domain/address and a scheduled invocation of the `send-reminders` Edge Function.

1. Set the secrets (use your own values and never commit them):
   ```bash
   supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY 'REMINDER_FROM_EMAIL=ApplySignal <verified-sender@example.com>' REMINDER_CRON_SECRET=YOUR_LONG_RANDOM_SECRET
   ```
   Keep the same `REMINDER_CRON_SECRET` in Supabase Vault for the scheduled HTTP request. You can generate a random secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Deploy:
   ```bash
   supabase functions deploy send-reminders
   ```
   `supabase/config.toml` disables platform JWT verification for this one function only; the function itself checks `Authorization: Bearer <REMINDER_CRON_SECRET>`. Keep that secret private.
3. In Supabase, enable the `pg_cron`, `pg_net`, and Vault extensions if available for your project. Store the function URL and cron secret in Vault:
   ```sql
   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-reminders', 'applysignal_reminder_url');
   select vault.create_secret('YOUR_LONG_RANDOM_SECRET', 'applysignal_reminder_cron_secret');
   ```
4. Schedule the daily call (08:00 India time / 02:30 UTC):
   ```sql
   select cron.schedule(
     'applysignal-daily-reminders',
     '30 2 * * *',
     $$ select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'applysignal_reminder_url' limit 1),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'applysignal_reminder_cron_secret' limit 1)
       ),
       body := '{}'::jsonb
     ); $$
   );
   ```

The scheduled function sends a digest only to users who enabled email reminders and whose account has an email address. It tracks deliveries server-side to avoid repeated sends for the same reminder date. Email sending has not been verified without your Resend/Supabase credentials. Browser push notifications are not implemented.

## 8. Supabase Realtime

The app subscribes to user-scoped changes for applications, opportunities, skill analyses, learning tasks, profiles, and reminder dismissals. Migration 005 adds these tables to `supabase_realtime` when that publication exists. If Realtime is disabled in the project, enable it in Supabase and confirm the tables are included. Row Level Security remains the security boundary; client subscriptions also filter by the signed-in user's `user_id`.

## 9. Tests and verification

Run locally:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:functions
npm run test:db      # optional: needs Bash + local PostgreSQL (Git Bash/WSL on Windows)
npm run test:e2e     # optional: needs your own test Supabase account
```

`npm run test:functions` runs the real `ai` and `send-reminders` Edge Function code under Deno with a stubbed Supabase client and mocked Gemini/OpenAI/Resend responses (CORS, auth, input limits, fail-closed quota, provider errors, digest rules, duplicate-send protection). It makes no network calls and proves the function logic, **not** that your deployed secrets, provider account or Resend domain work.

`npm run test:db` requires Bash and a local PostgreSQL 15+ superuser connection. It creates unique throwaway databases, checks fresh install and upgrade paths, ownership constraints, and concurrent AI quota enforcement, then removes only those databases it created.

`npm run test:e2e` runs live smoke tests against a dedicated test account. Set `SUPABASE_E2E_URL`, `SUPABASE_E2E_ANON_KEY`, `SUPABASE_E2E_EMAIL`, and `SUPABASE_E2E_PASSWORD` in your terminal environment. Optionally set `SUPABASE_E2E_OTHER_EMAIL` and `SUPABASE_E2E_OTHER_PASSWORD` to test cross-user isolation, and set `SUPABASE_E2E_TEST_AI=true` to make real AI calls (may incur provider costs). Use a dedicated test account/project; the script creates and deletes test records. It does not automate browser clicks or signup email confirmation.

UI tests use an in-memory fake backend; they are not a substitute for live Supabase browser tests. Before release, manually test sign-up, email confirmation, login, password reset, application CRUD, AI requests, resume extraction/OCR, Gmail OAuth, email delivery, and cross-user isolation in your own project.

## 10. Limitations

- Gmail import is opt-in/manual and reads up to ten recent matching emails; it is not a background scanner.
- WhatsApp personal chats and LinkedIn inbox/job data are not integrated. Their APIs and permissions are restricted; use pasted text or CSV/JSON import for those sources.
- No browser push notifications.
- OCR currently handles scanned PDFs only, not images inside DOCX.
- End-to-end tests against your live Supabase project and live provider requests require your credentials and still need to be run.


## Verification status

Last verified by actually running the commands below in a Linux sandbox (Node 22, PostgreSQL 16, Deno 2.9):

| Check | Result |
| --- | --- |
| `npm ci` | passed |
| `npm run typecheck` | passed |
| `npm test` (Vitest, 44 tests incl. Profile save/reload and password-reset screens) | passed |
| `npm run build` | passed |
| `npm run test:db` (fresh install + legacy upgrade + RLS + grants + 15-way concurrent quota) | passed, 0 failures |
| `npm run test:functions` (38 `ai` + 25 `send-reminders` checks) | passed |
| `deno check` of both Edge Functions against real supabase-js types | passed |

**Not verified anywhere yet (needs your accounts):** a live Supabase project, real sign-up/email confirmation, live Gemini/OpenAI calls, Resend delivery, `pg_cron` scheduling, Gmail OAuth, Realtime delivery, browser layout on phone/tablet, and deployment. Use the manual checklist you were given and `npm run test:e2e` against a dedicated test account.

**Known limitations:** in-app reminders use the *browser's* time zone; the Profile time zone only affects the email digest. A failed provider call still uses one unit of the hourly AI quota. `npm audit` reports moderate advisories in production dependencies (`react-router`, and `mammoth` via `argparse`/`sprintf-js`) and high/critical ones only in dev tooling (`vite` dev server, `vitest`, `tinypool`) that is not part of the production build. Fixes need breaking major upgrades (vite 8, vitest 5, react-router 7), so they were not applied; do not expose the dev server to untrusted networks.
