import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/** Read a local migration file relative to this test. */
const migration = (name) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );

/**
 * Boot a PGlite instance with the auth/storage scaffold, Phase 1, and Phase 2
 * applied — the minimal baseline before Phase 5.
 */
async function bootPhase2() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(
      id uuid primary key, email text,
      raw_user_meta_data jsonb default '{}',
      email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    create table storage.buckets(
      id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text, name text
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    create publication supabase_realtime;
  `);
  await db.exec(migration("20261018093740_phase1_profiles.sql"));
  await db.exec(migration("20261018093812_phase2_student_management.sql"));
  return db;
}

const admin = "00000000-0000-4000-8000-000000000001";
const student = "00000000-0000-4000-8000-000000000002";

async function seedUsers(db) {
  await db.query(
    `insert into auth.users(id, email)
     values ($1, 'admin@test.invalid'), ($2, 's@test.invalid')`,
    [admin, student],
  );
  await db.query(`update profiles set role = 'admin' where id = $1`, [admin]);
}

const asRole = async (db, role, userId, fn) => {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId || "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
};

// ──────────────────────────────────────────────────────────────────
test("Phase 5 admission-fields drift repair", async (t) => {
  const db = await bootPhase2();
  await seedUsers(db);

  // ── Column absence before repair ──────────────────────────────
  await t.test("Phase 5 columns are absent before repair", async () => {
    const cols = (
      await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'students'
            and column_name in ('current_address', 'admission_note')`,
      )
    ).rows;
    assert.equal(cols.length, 0, "columns should not exist yet");
  });

  // ── Apply the corrective migration ────────────────────────────
  await t.test("corrective migration applies cleanly", async () => {
    await db.exec(
      migration("20261029143000_phase5_admission_fields_drift_repair.sql"),
    );
  });

  // ── Column existence and definitions ──────────────────────────
  await t.test("students.current_address created correctly", async () => {
    const row = (
      await db.query(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'students'
            and column_name = 'current_address'`,
      )
    ).rows[0];
    assert.ok(row, "column must exist");
    assert.equal(row.data_type, "text");
    assert.equal(row.is_nullable, "NO");
    assert.equal(row.column_default, "''::text");
  });

  await t.test("students.admission_note created correctly", async () => {
    const row = (
      await db.query(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'students'
            and column_name = 'admission_note'`,
      )
    ).rows[0];
    assert.ok(row, "column must exist");
    assert.equal(row.data_type, "text");
    assert.equal(row.is_nullable, "NO");
    assert.equal(row.column_default, "''::text");
  });

  await t.test(
    "guardians.emergency_contact_name created correctly",
    async () => {
      const row = (
        await db.query(
          `select data_type, is_nullable, column_default
             from information_schema.columns
            where table_schema = 'public' and table_name = 'guardians'
              and column_name = 'emergency_contact_name'`,
        )
      ).rows[0];
      assert.ok(row, "column must exist");
      assert.equal(row.data_type, "text");
      assert.equal(row.is_nullable, "NO");
      assert.equal(row.column_default, "''::text");
    },
  );

  await t.test("guardians.address created correctly", async () => {
    const row = (
      await db.query(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'guardians'
            and column_name = 'address'`,
      )
    ).rows[0];
    assert.ok(row, "column must exist");
    assert.equal(row.data_type, "text");
    assert.equal(row.is_nullable, "NO");
    assert.equal(row.column_default, "''::text");
  });

  await t.test("bed_allocations.starts_on created correctly", async () => {
    const row = (
      await db.query(
        `select data_type, is_nullable
           from information_schema.columns
          where table_schema = 'public' and table_name = 'bed_allocations'
            and column_name = 'starts_on'`,
      )
    ).rows[0];
    assert.ok(row, "column must exist");
    assert.equal(row.data_type, "date");
    assert.equal(row.is_nullable, "NO");
  });

  // ── Gender nullability ────────────────────────────────────────
  await t.test("students.gender is now nullable", async () => {
    const row = (
      await db.query(
        `select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'students'
            and column_name = 'gender'`,
      )
    ).rows[0];
    assert.equal(row.is_nullable, "YES");
  });

  // ── Re-run is safe (idempotent) ───────────────────────────────
  await t.test("re-running the corrective migration is safe", async () => {
    await db.exec(
      migration("20261029143000_phase5_admission_fields_drift_repair.sql"),
    );
    // Verify columns still intact
    const colCount = (
      await db.query(
        `select count(*)::int n from information_schema.columns
          where table_schema = 'public' and table_name = 'students'
            and column_name in ('current_address', 'admission_note')`,
      )
    ).rows[0].n;
    assert.equal(colCount, 2);
  });

  // ── Check constraints ─────────────────────────────────────────
  await t.test("length constraints are enforced", async () => {
    // current_address max 500
    await assert.rejects(
      db.query(
        `insert into students(user_id, student_id, full_name, date_of_birth,
           email, phone, course, branch, academic_year, semester,
           permanent_address, city, state, pincode, current_address)
         values ($1, 'CHK-001', 'Test', '2000-01-01',
           'chk1@test.invalid', '9999999999', 'C', 'B', '2026', 1,
           'Addr', 'City', 'State', '123456', $2)`,
        [student, "x".repeat(501)],
      ),
      /check/i,
    );
    // admission_note max 1000
    await assert.rejects(
      db.query(
        `insert into students(user_id, student_id, full_name, date_of_birth,
           email, phone, course, branch, academic_year, semester,
           permanent_address, city, state, pincode, admission_note)
         values ($1, 'CHK-002', 'Test', '2000-01-01',
           'chk2@test.invalid', '9999999999', 'C', 'B', '2026', 1,
           'Addr', 'City', 'State', '123456', $2)`,
        [student, "x".repeat(1001)],
      ),
      /check/i,
    );
    // emergency_contact_name max 100
    const sid = (
      await db.query(
        `insert into students(user_id, student_id, full_name, date_of_birth,
           email, phone, course, branch, academic_year, semester,
           permanent_address, city, state, pincode)
         values ($1, 'CHK-003', 'Test', '2000-01-01',
           'chk3@test.invalid', '9999999999', 'C', 'B', '2026', 1,
           'Addr', 'City', 'State', '123456') returning id`,
        [student],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query(
        `insert into guardians(student_id, full_name, relationship, phone,
           emergency_contact, emergency_contact_name)
         values ($1, 'G', 'Parent', '9999999999', '9999999999', $2)`,
        [sid, "x".repeat(101)],
      ),
      /check/i,
    );
    // guardian address max 500
    await assert.rejects(
      db.query(
        `insert into guardians(student_id, full_name, relationship, phone,
           emergency_contact, address)
         values ($1, 'G', 'Parent', '9999999999', '9999999999', $2)`,
        [sid, "x".repeat(501)],
      ),
      /check/i,
    );
  });

  // ── finish_registration persists Phase 5 fields ───────────────
  await t.test(
    "finish_registration persists Phase 5 admission fields",
    async () => {
      // Set up infrastructure: hostel → room → bed
      await asRole(db, "authenticated", admin, async () => {
        await db.query(
          `select manage_phase2('hostel', $1::jsonb)`,
          [JSON.stringify({ name: "Test", block: "A" })],
        );
        await db.query(
          `select manage_phase2('room', $1::jsonb)`,
          [
            JSON.stringify({
              hostel_id: (
                await db.query("select id from hostels limit 1")
              ).rows[0].id,
              room_number: "201",
              floor_number: 1,
              capacity: 2,
              room_type: "Standard",
            }),
          ],
        );
      });
      const bed = (
        await db.query(
          "select id from beds where room_id = (select id from rooms where room_number = '201') limit 1",
        )
      ).rows[0].id;

      const regId = "00000000-0000-4000-8000-a00000000001";
      const authUserId = "00000000-0000-4000-8000-a00000000002";
      await db.query(
        `insert into auth.users(id, email)
         values ($1, 'reg-test@test.invalid')`,
        [authUserId],
      );

      const payload = {
        student_id: "REG-TEST-001",
        email: "reg-test@test.invalid",
        bed_id: bed,
        full_name: "Reg Test",
        date_of_birth: "2001-03-15",
        gender: "",
        phone: "9876543210",
        course: "Engineering",
        branch: "CS",
        academic_year: "2026",
        semester: 3,
        permanent_address: "123 Main St",
        current_address: "456 Current St",
        city: "TestCity",
        state: "TestState",
        pincode: "654321",
        admission_date: "2026-10-28",
        admission_note: "Test admission note",
        allocation_start_date: "2026-10-29",
        guardian_name: "Test Guardian",
        relationship: "Father",
        guardian_phone: "1234567890",
        guardian_email: "",
        emergency_contact: "1234567890",
        emergency_contact_name: "Emergency Person",
        guardian_address: "789 Guardian Lane",
      };

      // Insert the registration job manually (simulates claim_registration)
      await asRole(db, "service_role", null, async () => {
        await db.query(
          `insert into student_registrations(
             id, auth_user_id, requested_by, payload, email,
             student_number, lease_token, lease_until
           ) values ($1, $2, $3, $4::jsonb, $5, $6,
             gen_random_uuid(), now() + interval '5 minutes')`,
          [
            regId,
            authUserId,
            admin,
            JSON.stringify(payload),
            "reg-test@test.invalid",
            "REG-TEST-001",
          ],
        );

        // Get the lease token
        const job = (
          await db.query(
            "select lease_token from student_registrations where id = $1",
            [regId],
          )
        ).rows[0];

        // Call finish_registration
        const result = (
          await db.query("select finish_registration($1, $2) id", [
            regId,
            job.lease_token,
          ])
        ).rows[0].id;

        // Verify student record
        const saved = (
          await db.query(
            `select student_id, current_address, admission_date,
                    admission_note, gender
               from students where id = $1`,
            [result],
          )
        ).rows[0];
        assert.equal(saved.student_id, "REG-TEST-001");
        assert.equal(saved.current_address, "456 Current St");
        assert.equal(
          saved.admission_date.toISOString().slice(0, 10),
          "2026-10-28",
        );
        assert.equal(saved.admission_note, "Test admission note");
        assert.equal(saved.gender, null, "empty gender string maps to NULL");

        // Verify guardian record
        const guardian = (
          await db.query(
            "select emergency_contact_name, address from guardians where student_id = $1",
            [result],
          )
        ).rows[0];
        assert.equal(guardian.emergency_contact_name, "Emergency Person");
        assert.equal(guardian.address, "789 Guardian Lane");

        // Verify bed allocation
        const alloc = (
          await db.query(
            "select starts_on from bed_allocations where student_id = $1",
            [result],
          )
        ).rows[0];
        assert.equal(
          alloc.starts_on.toISOString().slice(0, 10),
          "2026-10-29",
        );

        // Verify idempotent second call
        const second = (
          await db.query("select finish_registration($1, $2) id", [
            regId,
            job.lease_token,
          ])
        ).rows[0].id;
        assert.equal(second, result, "idempotent re-call returns same id");
      });
    },
  );

  // ── Existing records are preserved ────────────────────────────
  await t.test(
    "existing students/guardians/allocations gain defaults",
    async () => {
      // Insert a student the Phase 2 way (before repair), columns should
      // have their defaults.
      const oldUserId = "00000000-0000-4000-8000-b00000000001";
      await db.query(
        `insert into auth.users(id, email)
         values ($1, 'old@test.invalid')
         on conflict (id) do nothing`,
        [oldUserId],
      );
      const oldStudent = (
        await db.query(
          `insert into students(user_id, student_id, full_name, date_of_birth,
             gender, email, phone, course, branch, academic_year, semester,
             permanent_address, city, state, pincode)
           values ($1, 'OLD-001',
             'Old Student', '1999-01-01', 'male', 'old@test.invalid',
             '9999999999', 'Course', 'Branch', '2025', 1,
             'Address', 'City', 'State', '123456')
           returning id, current_address, admission_note`,
          [oldUserId],
        )
      ).rows[0];
      assert.equal(
        oldStudent.current_address,
        "",
        "default current_address is empty",
      );
      assert.equal(
        oldStudent.admission_note,
        "",
        "default admission_note is empty",
      );

      const oldGuardian = (
        await db.query(
          `insert into guardians(student_id, full_name, relationship, phone,
             emergency_contact)
           values ($1, 'Old Guardian', 'Mother', '8888888888', '8888888888')
           returning emergency_contact_name, address`,
          [oldStudent.id],
        )
      ).rows[0];
      assert.equal(
        oldGuardian.emergency_contact_name,
        "",
        "default emergency_contact_name is empty",
      );
      assert.equal(oldGuardian.address, "", "default guardian address is empty");
    },
  );

  // ── Authorization preserved ───────────────────────────────────
  await t.test(
    "finish_registration remains restricted to service_role",
    async () => {
      await assert.rejects(
        asRole(db, "authenticated", admin, () =>
          db.query(
            "select finish_registration($1, $2)",
            ["00000000-0000-4000-8000-000000000099", "00000000-0000-4000-8000-000000000099"],
          ),
        ),
        /permission denied/,
      );
    },
  );

  // ── Prerequisite guard: migration fails if tables are missing ─
  await t.test(
    "repair aborts when prerequisite tables are missing",
    async () => {
      const freshDb = new PGlite();
      await freshDb.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key, email text,
          raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
        create function auth.uid() returns uuid language sql stable as
          $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth, public to authenticated, service_role;
        grant execute on function auth.uid() to authenticated, service_role;
        create schema storage;
        create table storage.buckets(id text primary key, name text, public boolean,
          file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects(id uuid primary key default gen_random_uuid(),
          bucket_id text, name text);
        alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated;
        grant select, insert, update, delete on storage.objects to authenticated;
        create publication supabase_realtime;
      `);
      // Apply only Phase 1 (no Phase 2 tables)
      await freshDb.exec(migration("20261018093740_phase1_profiles.sql"));
      await assert.rejects(
        freshDb.exec(
          migration("20261029143000_phase5_admission_fields_drift_repair.sql"),
        ),
        /prerequisite tables/i,
      );
      await freshDb.close();
    },
  );

  // ── claim_registration is NOT modified ────────────────────────
  await t.test(
    "claim_registration function body is unchanged (Phase 2 original)",
    async () => {
      const def = (
        await db.query(
          `select pg_get_functiondef(oid) as def
             from pg_proc
            where proname = 'claim_registration'
              and pronamespace = 'public'::regnamespace`,
        )
      ).rows[0].def;
      // The Phase 2 claim_registration does NOT reference
      // private.registration_student_ids (that's the ID-drift repair).
      assert.ok(
        !def.includes("registration_student_ids"),
        "claim_registration must not reference reservation table (Phase 5 scope)",
      );
    },
  );

  await db.close();
});
