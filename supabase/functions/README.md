# Privileged operations

## Phase 2

The last deployment report records `student-registration` version 1 ACTIVE on `mvbbxgeqtyotfirnjicm` on 18 October 2026, but also reports missing `APP_ORIGIN`. Current remote status was not available for reinspection. The current local admission form adds Phase 5 fields introduced after that deployment. Because the function schema is strict, the older deployed version is a likely cause of the generic `Invalid registration information` response: it can reject the added keys. This is an inference from deployment chronology and strict schema; current remote code could not be checked. Local code returns invalid field paths without submitted values, but this diagnostic update and required migrations have not been deployed.

`student-registration/index.ts` validates the caller's JWT and active admin profile, supports durable idempotent account provisioning and invitation retries, and uses the server-only service-role key. Set `APP_ORIGIN` to the exact app origin; do not infer it from an untrusted request. Verify/apply Phase 5 (`20261024120000_phase5_student_admission_fields.sql`) before deploying a function version that sends those fields, and apply the ID reservation migration (`20261025100000_student_id_generation.sql`) before deploying code that calls its RPC. Reconcile remote migration history first. See `../../README.md` for configuration steps and `../DEPLOYMENT_REPORT.md` for the last verified remote state.

Run isolated workflow tests with `npx --yes deno test --node-modules-dir=none --allow-env supabase/functions/student-registration/index.test.ts` from the project root. These tests stub remote services; they do not test inbox delivery.

## Phase 1 foundation

Phase 1 requires no Edge Function: provisioning and role changes use the Supabase Dashboard SQL editor with trusted project administrator access. There is deliberately no public admin-creation endpoint.

Future invitation and role-management Edge Functions must validate the caller JWT, query their active admin profile server-side, validate input, and only then use a server-only service-role client. Never trust user_metadata for authorization. Never ship service-role or secret keys to Vite. Apply new RLS policies through migrations before adding module data. The current schema is single-campus; multi-campus operation requires tenant membership and tenant-scoped policies first.

## QR gate verification and guard accounts

The local `20261103151402_dedicated_security_guard_gate_verification.sql` migration reuses `gate_passes`, `gate_events`, `student_presence`, `leave_requests`, and `profiles`. It converts legacy `security` profiles to `security_guard`, issues one hashed-token pass per approved leave, removes direct authenticated scan RPC access, and grants guards no direct reads of gate audit tables. Gate movements run through `gate-verification`; the database locks the leave, pass, and presence rows and commits the event and presence update together. The separate `security-guards` function is admin-only and creates/activates/deactivates guard profiles.

Both new functions require `APP_ORIGIN` to be the exact deployed app origin (for this project: `https://hostel.amitkumar.info.np`). They also use the server-side `SUPABASE_SERVICE_ROLE_KEY` supplied to Supabase Edge Functions. Neither key belongs in Vite environment variables. `verify_jwt` remains enabled for both functions, with an additional server-side role and active-account check.

Deploy after reconciling the linked project's migration state:

```powershell
npx supabase login
npx supabase link --project-ref mvbbxgeqtyotfirnjicm
npx supabase migration list --linked
npx supabase db push
npx supabase secrets set APP_ORIGIN=https://hostel.amitkumar.info.np
npx supabase functions deploy gate-verification
npx supabase functions deploy security-guards
```

Then deploy the frontend to Vercel with the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` variables. Confirm the Vercel project's root directory includes `vercel.json` and its SPA rewrite. In the admin UI, create a guard account and hand the one-time temporary password directly to that guard. Test `/gate/verify` with a guard session and a pass issued for an approved leave before enabling gate use.
