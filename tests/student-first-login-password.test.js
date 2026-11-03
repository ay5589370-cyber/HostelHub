import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";

const passwordPolicySchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(100, "Password cannot exceed 100 characters.");

test("password policy enforces min 12, max 100, and preserves literal whitespace", () => {
  assert.equal(passwordPolicySchema.safeParse("short").success, false);
  assert.equal(passwordPolicySchema.safeParse("12345678901").success, false);
  assert.equal(passwordPolicySchema.safeParse("123456789012").success, true);
  assert.equal(passwordPolicySchema.safeParse("a".repeat(100)).success, true);
  assert.equal(passwordPolicySchema.safeParse("a".repeat(101)).success, false);

  // Verifies whitespace is NOT trimmed or transformed
  const passphraseWithSpaces = " Correct Horse Battery Staple! ";
  const result = passwordPolicySchema.safeParse(passphraseWithSpaces);
  assert.equal(result.success, true);
  assert.equal(result.data, passphraseWithSpaces);
});

test("complete_student_password_setup database lifecycle in PGLite", async (t) => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
  `);

  // Load migration chain
  const migrations = [
    "../supabase/migrations/20261018093740_phase1_profiles.sql",
    "../supabase/migrations/20261018093812_phase2_student_management.sql",
    "../supabase/migrations/20261024120000_phase5_student_admission_fields.sql",
    "../supabase/migrations/20261027100000_temporary_student_credentials.sql",
    "../supabase/migrations/20261029140000_student_registration_id_drift_repair.sql",
    "../supabase/migrations/20261029143000_phase5_admission_fields_drift_repair.sql",
    "../supabase/migrations/20261030210000_first_login_password_setup.sql",
    "../supabase/migrations/20261030220000_harden_profiles_rls.sql",
  ];

  for (const file of migrations) {
    await db.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  }

  const adminId = "00000000-0000-4000-8000-000000000001";
  const studentId = "00000000-0000-4000-8000-000000000002";
  const regId = "00000000-0000-4000-8000-000000000010";

  await db.query(
    `insert into auth.users(id, email) values($1, 'admin@test.invalid'), ($2, 'student@test.invalid')`,
    [adminId, studentId],
  );
  await db.query(
    `update public.profiles set role = case when id = $1 then 'admin' else 'student' end`,
    [adminId],
  );

  const as = async (role, id, fn) => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
      id || "",
    ]);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };

  await t.test("SECURITY: authenticated users cannot call complete_student_password_setup", async () => {
    await assert.rejects(
      as("authenticated", studentId, async () => {
        await db.query("select complete_student_password_setup($1)", [studentId]);
      }),
      /permission denied/i,
    );
  });

  await t.test("SECURITY: service_role cannot complete password setup without credentials_ready registration", async () => {
    await db.query("update public.profiles set must_change_password = true where id = $1", [studentId]);

    // No registration exists yet
    await assert.rejects(
      as("service_role", null, async () => {
        await db.query("select complete_student_password_setup($1)", [studentId]);
      }),
      /Expected exactly one registration record with credentials_ready status/i,
    );

    // Profile flag must still be true (rollback guaranteed)
    const check = await db.query("select must_change_password from public.profiles where id = $1", [studentId]);
    assert.equal(check.rows[0].must_change_password, true);
  });

  await t.test("VALID FLOW: service_role finalizes password setup atomically", async () => {
    // Insert valid registration in credentials_ready
    await db.query(
      `insert into public.student_registrations(id, requested_by, payload, email, student_number, auth_user_id, invitation_status)
       values($1, $2, '{"full_name":"Test Student"}'::jsonb, 'student@test.invalid', 'HH-00000010', $3, 'credentials_ready')`,
      [regId, adminId, studentId],
    );

    await as("service_role", null, async () => {
      await db.query("select complete_student_password_setup($1)", [studentId]);
    });

    const prof = await db.query("select must_change_password from public.profiles where id = $1", [studentId]);
    assert.equal(prof.rows[0].must_change_password, false);

    const reg = await db.query("select invitation_status from public.student_registrations where id = $1", [regId]);
    assert.equal(reg.rows[0].invitation_status, "password_set");
  });

  await t.test("IDEMPOTENCY: second invocation fails safely without modifying other users", async () => {
    // Since registration is already password_set and profile is false, calling again must fail
    await assert.rejects(
      as("service_role", null, async () => {
        await db.query("select complete_student_password_setup($1)", [studentId]);
      }),
      /No pending first-login password change exists/i,
    );
  });
});

test("profiles_update_self RLS blocks direct must_change_password writes by authenticated users", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
  `);

  const migrations = [
    "../supabase/migrations/20261018093740_phase1_profiles.sql",
    "../supabase/migrations/20261018093812_phase2_student_management.sql",
    "../supabase/migrations/20261024120000_phase5_student_admission_fields.sql",
    "../supabase/migrations/20261027100000_temporary_student_credentials.sql",
    "../supabase/migrations/20261029140000_student_registration_id_drift_repair.sql",
    "../supabase/migrations/20261029143000_phase5_admission_fields_drift_repair.sql",
    "../supabase/migrations/20261030210000_first_login_password_setup.sql",
    "../supabase/migrations/20261030220000_harden_profiles_rls.sql",
  ];

  for (const file of migrations) {
    await db.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  }

  const studentId = "00000000-0000-4000-8000-000000000002";
  await db.query(
    `insert into auth.users(id, email) values($1, 'student@test.invalid')`,
    [studentId],
  );
  // Profile is auto-created as student by the trigger; set must_change_password = true via service_role
  await db.exec(`set role service_role`);
  await db.query(`update public.profiles set must_change_password = true where id = $1`, [studentId]);
  await db.exec(`reset role`);

  // Confirm flag is true before the test
  const before = await db.query(
    `select must_change_password from public.profiles where id = $1`,
    [studentId],
  );
  assert.equal(before.rows[0].must_change_password, true, "Pre-condition: flag must start true");

  // Attempt to clear must_change_password as the authenticated student
  // The column-level UPDATE grant only covers (full_name, phone), so PostgREST/PGlite
  // will reject this with a permission denied error.
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [studentId]);

  await assert.rejects(
    async () => {
      await db.query(
        `update public.profiles set must_change_password = false where id = $1`,
        [studentId],
      );
    },
    /permission denied/i,
    "Authenticated role must not be able to write must_change_password",
  );

  await db.exec(`reset role`);

  // Confirm the flag is still true after the rejected attempt
  const after = await db.query(
    `select must_change_password from public.profiles where id = $1`,
    [studentId],
  );
  assert.equal(
    after.rows[0].must_change_password,
    true,
    "must_change_password must remain true after rejected write attempt",
  );
});

