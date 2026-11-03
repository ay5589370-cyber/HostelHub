# Phase 13 local review — Weekly mess routine

## Functionality

- Admins can maintain the recurring Sunday–Saturday breakfast, lunch and dinner plan.
- Serving times are shared by weekday and editable for all three meals. Seed defaults are breakfast 07:00–08:00, lunch 12:30–14:00, and dinner 19:30–21:00.
- The student dashboard displays the weekly schedule and the configured serving times. Empty entries show “Menu not posted yet”; no meal data is fabricated.
- Existing dated menus and the existing student mess page remain separate and unchanged.

## Migration and security

`20261102163436_weekly_mess_routine.sql` is additive and requires Phase 1 profiles/admin checks plus Phase 8's active-student helper. It creates one row per weekday/meal and one row per meal time, seeds 21 blank menu rows and three default time rows, enables RLS, and grants authenticated users only the columns needed to read the schedule. The select policies limit access to active admins and active students. Table writes are not granted to authenticated users. The only write path is `mess_save_weekly_routine(jsonb,jsonb)`, which validates the full seven-day schedule and all three time ranges and checks active-admin status on the server.

The live project `mvbbxgeqtyotfirnjicm` initially had Phase 7 but no Phase 8 or mess tables. After the user explicitly approved both migrations, Phase 8 and Phase 13 were applied in sequence on 2026-11-02. The remote migration history now records `phase8_mess_management` and `phase13_weekly_mess_routine`.

## Verification

- PGlite migration test checks the 21/3 seeds, configured times, admin edits, student reads, denied student writes, and denied student RPC calls.
- Remote verification confirms RLS is enabled on both new tables, each has an active-reader policy, there are 21 routine rows spanning 7 weekdays and 3 meals, the three default meal times are present, and the save RPC exists.
- `npm test`: 94 passed.
- `npm run lint`: passed.
- `npm run build`: passed (Vite reports existing removable `@__PURE__` annotation warnings from Zod dependencies).

The two database migrations are now live. Frontend source changes are local and need the normal frontend build/deployment step before they appear in the deployed web app.
