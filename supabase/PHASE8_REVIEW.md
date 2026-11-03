# Phase 8 local review — Mess & food management

## Local implementation

- `/admin/mess`: create/edit draft menus, publish/cancel/archive, cancellation announcements, feedback edit-window policy, date/meal/title filters, feedback summary, and recent mess complaints.
- `/student/mess`: published weekly menus with serving times and allergens, cancellation notices, one feedback submission per meal/date, policy-window feedback editing, and mess complaints/history.
- Mess complaint categories use the existing Phase 7 complaint RPC, ownership policies, timeline, staff assignment/status workflow, and attachment controls. No parallel complaint system was added.
- Meal attendance is deferred because the project has no reliable meal check-in mechanism.
- Notices are in-app only. No email or SMS delivery is claimed.

## Migration dependency and safety

`20261025130000_phase8_mess_management.sql` requires Phase 1 profiles/admin helper, Phase 2 students, and Phase 7 complaints and `complaint_submit(jsonb,uuid)`. It adds mess menu, feedback, feedback policy, notices, and event tables; RLS is enabled on each. It extends the existing complaint category constraint while preserving all prior category values. It does not drop tables or delete rows. It does not depend on Phases 3, 4, 5, or 6 schemas.

Apply it only after verifying the remote migration history and Phase 7 schema. The live project `mvbbxgeqtyotfirnjicm` initially had Phase 7 but no Phase 8 or mess tables. After explicit user approval, Phase 8 was applied on 2026-11-02, followed by Phase 13 weekly routine. Do not use a blind `db push` or repair migration history based on that result.

The exact Phase 8 change is the single migration above. It was applied to `mvbbxgeqtyotfirnjicm` on 2026-11-02 after explicit user approval. No production data was deleted or reset, and no unrelated project was changed.

## Authorization model

- Admin-only writes and analytics run through fixed-search-path security-definer RPCs that check `private.is_active_admin()`.
- Students resolve their own active student row from `auth.uid()`; submitted student IDs and roles are not trusted.
- Students can read only published/cancelled menus, their own feedback and their own notices. Admins can read all feedback and menu data.
- Feedback has a unique `(student_id, meal_date, meal_slot)` constraint. Updates go through the RPC and require an admin-configured edit window (default zero hours).
- Meal cancellation requires an announcement and generates in-app student notices. Re-publication clears a previous cancellation message.
- Mess complaints use the existing complaint ownership and staff controls; internal notes remain hidden under existing complaint RLS.
- No public storage bucket, gateway, email, SMS, attendance, card data, or payment behavior is introduced.

## Remote access

The installed local Supabase CLI reports version `2.122.0`. Remote migration status and public tables were verified through the connected Supabase integration after the approved Phase 8 and Phase 13 migrations. Auth settings and SMTP remain unverified.
