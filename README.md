# HostelHub — Phase 1

**Phase 7 local implementation:** a student complaints portal, admin/warden queue, private complaint attachments, audit timeline, and linked maintenance tasks are implemented locally. Review [`supabase/PHASE7_REVIEW.md`](supabase/PHASE7_REVIEW.md) before applying its pending migration. Production deployment status is unverified; do not assume the migration has been applied.

**Phase 8 local implementation:** admin/student mess menus, announcements, meal feedback, and mess complaints integrated with Phase 7 are implemented locally. Review [`supabase/PHASE8_REVIEW.md`](supabase/PHASE8_REVIEW.md) before applying its migration. Deployment status is unverified; no live schema or storage configuration was changed.

**Phase 9 local integration:** the admin dashboard combines authorized module metrics, `/admin/reports` provides filtered CSV exports, and the student dashboard shows RLS-scoped account summaries. Its aggregate RPC migration remains local. See [`FINAL_READINESS_REPORT.md`](FINAL_READINESS_REPORT.md) and review [`20261025140000_phase9_operations_reporting.sql`](supabase/migrations/20261025140000_phase9_operations_reporting.sql) before any live apply.

**Phase 10 local integration:** `/admin/notifications` and `/student/notifications` provide recipient-scoped in-app history for leave, complaint, mess, and hostel-announcement notifications, with unread counts and read actions. Admins can draft, preview, publish, and archive in-app announcements through the Phase 10 migration. Parent email/SMS is deliberately disabled: guardian contacts are not verified, consent and preferences are not recorded, and no general outbound delivery worker is configured. Review all required migrations before using these pages remotely.

**Phase 11 local integration:** visitor desk, approval, identity-check status, check-in/out, student visit history, and admin/warden logs are implemented with a reviewed local migration. It reuses the existing student/gate authorization model and does not add QR passes. Every visit currently requires admin/warden approval because no visitor policy table exists. Review [`supabase/PHASE11_REVIEW.md`](supabase/PHASE11_REVIEW.md) before any live migration.

**Phase 2 deployment:** the approved database migrations and registration Edge Function are deployed to `Hostel` (`mvbbxgeqtyotfirnjicm`). Required origin, administrator and email configuration remain. See [deployment report](supabase/DEPLOYMENT_REPORT.md) for verification and next steps.

A React/Vite, JavaScript/JSX foundation for a **single-campus** smart hostel management system. Dark mode is the default; light mode is available on login and inside the workspace. This repository contains no backend server, public registration page, credentials, or seeded statistics.

## Run locally

Use Node.js 22.12+ (Node 24 was used during implementation).

```powershell
npm install
Copy-Item .env.example .env.local
# Edit .env.local with your project URL and public key.
npm run dev
```

Open the Vite URL printed in the terminal. Without configuration, login displays a setup notice and disables authentication rather than crashing or simulating a login.

```powershell
npm run lint
npm test
npm run build
npm run preview
```

`dist/` is the production output. Configure your static host to rewrite unknown paths to `/index.html` so direct links such as `/reset-password` and `/admin/dashboard` work. Use HTTPS in production. No separate Node backend is needed.

## Exactly what to configure in Supabase

1. Create a Supabase project for this campus. In the Dashboard's API settings/Connect dialog, copy its project URL and **publishable key** (or legacy **anon** key).
2. Set these values in `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-client-key
   ```

   The newer `sb_publishable_...` key works in the same variable and `createClient(url, key)` initialization. Never use `sb_secret_...` or `service_role`. Vite variables are embedded in the public bundle. Restart Vite after changes. For hosting, set both variables in the build environment before building.

3. In **Authentication → Sign In / Providers**, enable email/password and **disable Allow new users to sign up**. Do not enable anonymous signup. There is no public signup UI, but disabling the server-side signup setting also blocks direct signup API calls. Only provision accounts through trusted project administration.
4. In **Authentication → URL Configuration**, set the Site URL to your actual deployed application origin. The checked-in Vite setup and README identify the local development origin as `http://127.0.0.1:5173`; no production frontend origin is configured in this repository. Add the exact `<APP_ORIGIN>/reset-password` URL to the redirect allowlist. Do not add wildcard production URLs.
5. Configure custom SMTP in **Authentication → Email / SMTP Settings** and test the invitation template. For Google SMTP use `smtp.gmail.com`, port `587` with TLS/STARTTLS, the complete Gmail address as SMTP username and sender address, and a Google app password as SMTP password. Store the app password only in Dashboard settings. Workspace may require its administrator to allow SMTP and app passwords; a transactional SMTP provider is generally more suitable for production invitations. Supabase's built-in sender is restricted and not production mail. Keep the Supabase confirmation URL in the invitation template and configure a password policy of at least 12 characters.
6. Apply `supabase/migrations/20261018093740_phase1_profiles.sql` **once** through the SQL editor as the project owner. For repeatable environments, use the Supabase CLI and reconcile remote migration history before any push. The migration is intentionally not silently repeatable.
7. In **Data API settings**, keep `private` out of the exposed schemas. `public.profiles` has RLS enabled. Do not disable it. The SQL grants browser clients only SELECT and UPDATE on `full_name`/`phone`, with row policies.
8. Provision your first administrator using the procedure below. Then sign in, open settings, and save your name.
9. Realtime is a foundation only. `src/services/realtime.js` provides a scoped subscription with cleanup; the dashboard currently refreshes on load or manual refresh. No publication changes or subscriptions are activated automatically. When a future module needs it, add only the required table to `supabase_realtime` in a new migration, and use RLS-scoped subscriptions. Do not subscribe broadly to sensitive records.

## Secure first administrator provisioning

There is no public admin endpoint and no hardcoded administrator password.

1. In the trusted Supabase Dashboard, verify the intended administrator's identity out of band, then invite their real email from **Authentication → Users**. With SMTP configured, have them complete the invitation/password setup. Confirm the Auth account email is verified before promotion. Do not create a generic/shared admin login.
2. Copy the verified Auth user's UUID and exact email. The database trigger creates a **student** profile regardless of user metadata. As the trusted project owner, run the guarded SQL below after replacing all three placeholders. It promotes only that verified UUID/email pair and aborts unless exactly one active student profile matches:

   ```sql
   do $$
   declare
     target_id uuid := 'REPLACE_WITH_AUTH_USER_UUID'::uuid;
     target_email text := lower('VERIFIED_ADMIN_EMAIL');
     affected integer;
   begin
     if not exists (
       select 1 from auth.users u
       where u.id = target_id
         and lower(u.email) = target_email
         and u.email_confirmed_at is not null
     ) then
       raise exception 'Verified Auth identity does not match';
     end if;

     update public.profiles p
     set role = 'admin', full_name = 'Actual Administrator Name', is_active = true
     where p.id = target_id
       and lower(p.email) = target_email
       and p.role = 'student'
       and p.is_active;
     get diagnostics affected = row_count;
     if affected <> 1 then
       raise exception 'Expected exactly one active student profile; updated %', affected;
     end if;
   end $$;

   select id, email, role, is_active
   from public.profiles
   where id = 'REPLACE_WITH_AUTH_USER_UUID'::uuid;
   ```

3. Verify the query returns exactly one intended UUID with the verified email, `role = 'admin'`, and `is_active = true`. This privileged bootstrap is for the trusted project owner; do not make a public endpoint or browser UI for it. Do not run it until the verified account and intended admin identity are approved.
4. Provision future students/wardens only through the authenticated admin registration flow. Change a role or `is_active` only through trusted SQL or an authenticated Edge Function with server-side admin validation. Browser admins cannot change roles either.

## Registration deployment configuration

The last recorded deployment inspection found `APP_ORIGIN` missing, and the last recorded profile inspection found zero active admin profiles. Current remote settings were not available for reinspection. The local application origin is exactly `http://127.0.0.1:5173`; the repository contains no deployed production frontend URL.

For the local Vite app, set the function secret on the project already configured for this repository:

```powershell
supabase secrets set APP_ORIGIN=http://127.0.0.1:5173 --project-ref mvbbxgeqtyotfirnjicm
```

This command has not been run. The repository Supabase CLI is installed, but a fresh read-only migration check returned `AccessTokenRequiredError`; no access token was present. In **Authentication → URL Configuration**, set **Site URL** to the exact deployed app origin and add exactly `<APP_ORIGIN>/reset-password` to **Redirect URLs**. For local Vite, use `http://127.0.0.1:5173` and `http://127.0.0.1:5173/reset-password` respectively. Verify both settings in the Dashboard before testing invitations.

Student registration locally reserves unique `HH-00000001` style IDs in PostgreSQL and returns a cryptographically random one-time password to the admin. Email remains the student login name. The matching Edge Function marks the Auth email confirmed without sending an email; verify the student's address and securely hand over the password. Students must change it on first sign-in. This behavior is **not live until** `20261027100000_temporary_student_credentials.sql` and the updated function are deployed. First reconcile the remote history and actual schema for Phase 5 admission fields and the Phase 2 ID-generation dependency. Do not run a blind `db push` or retry registration against the older hosted function; it may still send an invitation.

The last confirmed registration deployment report recorded the function's `APP_ORIGIN` as missing, which can cause browser CORS preflight failures that surface as “Failed to send a request to the Edge Function.” The current “Invalid registration information” message means the function is reached but rejects its payload. The most likely cause is a stale strict-schema Edge Function: the last recorded deployment is 18 October, while the local admission payload gained Phase 5 fields later. This is an inference; the hosted function version and current schema could not be rechecked because CLI authentication is unavailable. The local function now returns field paths only on validation errors. Reconcile and apply the required Phase 5/ID migrations, configure `APP_ORIGIN`, and deploy the current function before relying on the hosted flow.

## Data and security model

- `profiles.id` references `auth.users.id`, with cascading deletion. Roles are constrained to `admin`, `student`, and `warden`. Name, email, avatar and phone have length limits, and timestamps and indexes are included.
- Auth user creation always initializes `student`; `raw_user_meta_data.role` is ignored. Auth email changes are synchronized to the profile.
- Users can read their own profile. Active admins can read all profiles in this **single campus**. Inactive admins lose access to other profiles immediately at the database layer.
- Users can update only their own name and phone while active. No browser role has INSERT, DELETE, or UPDATE privileges on role, active status, email, ID, avatar, or timestamps. RLS is not relied on alone to protect columns.
- A private, fixed-search-path `SECURITY DEFINER` helper checks the caller's active admin status without recursively evaluating the profile policy. It takes no arbitrary user ID and is not exposed as an API RPC. Other trigger functions have client EXECUTE revoked.
- Missing profiles, unknown roles, and inactive profiles fail closed in route guards. Role decisions never come from localStorage or editable user metadata. Supabase persists its session; only the theme preference is separately saved by this app.
- Profile checks run when the auth session changes or the page regains focus. A role change may leave an already visible page on screen until refresh; database policies still enforce access on every query. Future admin tables must have their own admin policies before they are used.
- Do not use this schema across independent institutions without tenant membership and tenant-scoped RLS migrations.

The implementation follows the official [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), [database function security guidance](https://supabase.com/docs/guides/database/functions), and [password recovery API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Implemented behavior

- Email/password login, sign out confirmation, persisted sessions, auth listener, session loading, friendly errors, password visibility toggle, forgot password email and reset completion.
- Protected routes and per-role guards; full admin shell and dedicated student/warden coming-soon pages.
- Dashboard: actual total student profile count (including inactive students), five explicitly deferred metrics, room chart empty state, leave empty state, and the five latest profile creations with real database timestamps. Recent activity is **profile creation history**, not a general audit log.
- Recharts occupancy component accepts future real data; it deliberately renders an empty state until room data exists. No invented values, trend percentages, or sample chart series.
- Responsive, collapsible sidebar, navigation search (not database search), current local date, profile dropdown, recipient-scoped notification center, quick navigation and dark/light themes.
- Settings persist the name/phone to Supabase; email and role are read-only. All future navigation destinations have distinct roadmap pages.
- Reusable accessible Radix confirmation/dropdown components, button variants compatible with shadcn conventions, skeletons, error/retry states, form validation, toast feedback, theme control and avatar initials.
- Realtime subscription helper, migration, secure provisioning procedure, and explicit configuration fallback.
- Complaints and maintenance: authenticated student submissions, server-derived allocation snapshots, private image attachments, staff-only internal notes, guarded status/assignment changes, a real staff queue summary, complaint-scoped notices, and idempotent linked maintenance tasks. Apply the reviewed Phase 7 migration before using the feature against Supabase.
- Mess and food management: admin menu publishing/cancellations, allergen display, student menu portal, policy-controlled feedback, admin feedback summaries, in-app notices, and mess complaints using the Phase 7 complaint workflow. Apply Phase 7 and Phase 8 migrations in order before use; meal attendance has no verified check-in source and remains deferred.
- Reports and integration: admin summaries use module-backed data and RLS-scoped queries; `/admin/reports` includes student, occupancy/allocation, leave, fee, payment, complaint/resolution, mess feedback, and available audit views with guarded CSV export. The student dashboard combines only records visible to the authenticated student. See the readiness report for metric definitions and deployment blockers.

## Deliberately deferred

| Phase | Modules                                                                                 |
| ----- | --------------------------------------------------------------------------------------- |
| 2     | Student invitations/registration, rooms, beds, allocation                               |
| 3     | Student profile features, room details, mess timetable                                  |
| 4     | Day/night leave, documents, approvals                                                   |
| 5     | QR gate passes, entry/exit, parent SMS, warden operations                               |
| 6     | Fees & payments, announcements, reports, analytics                                      |
| 7     | Live backend deployment and policy verification for complaints; remaining roadmap items |
| 8     | Live backend deployment and policy verification for mess; meal attendance               |
| 9     | Live migration reconciliation, dashboard RPC deployment, and production verification    |

General activity auditing, live dashboard subscriptions and occupancy datasets remain limited to their actual backend modules. Parent messaging and delivery retries are not exposed without verified contacts, consent, and a configured server-side provider.

## Packages

Runtime: `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `lucide-react`, `recharts`, `react-hook-form`, `@hookform/resolvers`, `zod`, `sonner`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-dropdown-menu`, `class-variance-authority`, `clsx`, `tailwind-merge`.

Build/lint/format: `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `globals`, `prettier`. Native Node test runner is used; no backend package is required. The lockfile records resolved dependency versions. Run `npm run format` to apply consistent formatting.

## Complete source layout / created files

The repository was empty; all files below were newly created. Generated `node_modules/` and `dist/` are ignored.

```text
Hostel/
  .env.example
  .gitignore
  README.md
  index.html
  package.json
  package-lock.json
  vite.config.js
  eslint.config.js
  src/
    main.jsx
    components/
      ui/Button.jsx
      layout/AppSidebar.jsx
      layout/AppHeader.jsx                # NotificationDropdown
      layout/DashboardLayout.jsx
      dashboard/StatCard.jsx
      dashboard/OccupancyChart.jsx
      common/ConfirmDialog.jsx
      common/Feedback.jsx                 # Logo, PageHeader, EmptyState,
                                          # LoadingSkeleton, ErrorState,
                                          # ThemeToggle, UserAvatar
    pages/
      auth/Login.jsx
      auth/Password.jsx
      auth/Unauthorized.jsx
      admin/Dashboard.jsx
      admin/Settings.jsx
      admin/ModulePlaceholder.jsx
      student/Dashboard.jsx
      warden/Dashboard.jsx
    contexts/AuthContext.jsx
    contexts/ThemeContext.jsx
    hooks/useQuery.js
    lib/supabase.js
    lib/utils.js
    services/profiles.js
    services/realtime.js
    routes/AppRoutes.jsx
    routes/Guards.jsx                     # ProtectedRoute, RoleGuard
    routes/navigation.js
    utils/access.js
    styles/globals.css
  supabase/
    migrations/20261018093740_phase1_profiles.sql
    functions/README.md
  tests/access.test.js
```

## Manual verification checklist

Run these against a disposable staging Supabase project before production. Local build and unit checks do not prove live Auth, SMTP, or RLS behavior.

- [ ] Without env vars, `/login` renders a useful setup notice; sign in is disabled. `/admin/dashboard` displays setup instructions without a blank screen.
- [ ] Apply the migration once. Verify indexes, constraints, triggers and RLS in the Dashboard.
- [ ] Provision one admin, one student and one warden through Auth; verify all initially get student roles, then promote only the required accounts through trusted SQL.
- [ ] Try invalid login and keyboard-only login; verify labels, visibility toggle, errors and busy state.
- [ ] Sign in as each role and refresh. Verify role-specific landing page and session persistence. Direct navigation to a different role's dashboard must be denied.
- [ ] Deactivate a test admin through SQL. Refocus/reload and verify denied access. Its session must not read other profiles even before reloading.
- [ ] Use the student/warden session and public SDK to select all profiles: only its own row is returned. Anonymous SELECT cannot access profiles.
- [ ] With the student, warden AND admin browser clients, attempt to update `role`, `is_active`, `email`, `id`, `created_at`; expect permission denied. INSERT/DELETE must fail. Updating another user's name must affect no rows. An active user's own name/phone update must succeed.
- [ ] Try setting `user_metadata.role` to admin; actual profile role and authorization must remain unchanged. Confirm direct public signup is disabled in Auth settings.
- [ ] Request recovery mail, open the link on the allowlisted origin, set matching passwords of 12+ characters, then sign in again. Test expired links and mismatched passwords. Verify generic recovery response doesn't reveal account existence.
- [ ] Compare dashboard student count and recent profile rows to SQL data. No future module may show a fake zero, chart or success state.
- [ ] Disconnect the network or temporarily remove table access; verify dashboard error/retry and profile-load recovery. Restore access and retry.
- [ ] Save settings, refresh and confirm persistence. Confirm email/role are not editable. Change themes, reload and verify preference.
- [ ] Exercise every sidebar destination, search matching/no-match/Escape/Enter, account dropdown, notifications and logout cancel/confirm.
- [ ] Check desktop, tablet and 375px mobile widths. Verify sidebar overlay, active links, focus indicators, readable cards and reduced-motion behavior.
- [ ] Run build and lint. Deploy with SPA rewrites and test direct `/reset-password` and dashboard URLs over HTTPS.

## Verification limits

Local checks completed on 17 October 2026: production build passed, ESLint passed with zero warnings/errors, and both role-routing test cases passed. Browser checks covered desktop login rendering, password visibility, light/dark switching, the 375px mobile login layout, disabled unconfigured recovery, the protected-route setup notice, and the invalid/expired reset-link state. The build emits harmless third-party Zod annotation warnings; compilation succeeds.

No live Supabase project or email service was supplied. The SQL migration, live login, password email delivery and cross-role database requests need the staging checks above. Unit tests cover role routing and fail-closed behavior; they do not replace PostgreSQL RLS integration tests. See the final implementation report for actual local build/lint results.

# Phase 2 update

Student management, registration/invitations, rooms/beds and student profiles are now implemented locally. Live activation awaits approval of the existing Phase 1 prerequisite and new Phase 2 migration. See [Phase 2 delivery](PHASE2_DELIVERY.md) and [database review](supabase/PHASE2_REVIEW.md) for files, tests, configuration and limitations.

# Phase 12 update

Fixed-asset and consumable inventory are implemented locally at `/admin/inventory`. The separate ledgers use guarded database RPCs, retain movement/stock history, and link to existing complaint maintenance tasks. No live migration has been applied; the migration depends on deployed Phase 1, Phase 2, and Phase 7 schema. See [Phase 12 review](supabase/PHASE12_REVIEW.md) for deployment prerequisites and limitations.
