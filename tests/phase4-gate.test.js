import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("Phase 4 Smart Gate Management & QR Verification database suite", async (t) => {
  const db = new PGlite();

  // Supabase bootstrap mocks
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;
    create publication supabase_realtime;
  `);

  // Run migrations 1, 2, 3, 4
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261018093740_phase1_profiles.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261018093812_phase2_student_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261021074458_phase3_leave_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261021153000_phase4_gate_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261029120000_phase4_gate_pass_secret_isolation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261029130000_phase4_gate_pass_display_details.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261024120000_phase5_student_admission_fields.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261025160000_phase11_visitor_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  // Setup actors
  const adminId = "00000000-0000-4000-8000-000000000001";
  const studentAId = "00000000-0000-4000-8000-000000000002";
  const studentBId = "00000000-0000-4000-8000-000000000003";
  const guardId = "00000000-0000-4000-8000-000000000005";
  const wardenId = "00000000-0000-4000-8000-000000000006";

  await db.query(
    `insert into auth.users(id, email) values
     ($1, 'admin@test.invalid'),
     ($2, 'studenta@test.invalid'),
     ($3, 'studentb@test.invalid'),
     ($4, 'guard@test.invalid'),
     ($5, 'warden@test.invalid')`,
    [adminId, studentAId, studentBId, guardId, wardenId],
  );

  await db.query(
    `update public.profiles set role = case
       when id = $1 then 'admin'
       when id = $2 then 'security'
       when id = $3 then 'warden'
       else 'student'
     end`,
    [adminId, guardId, wardenId],
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

  const rpc = async (action, data) =>
    (
      await db.query("select public.manage_phase2($1, $2::jsonb) as result", [
        action,
        JSON.stringify(data),
      ])
    ).rows[0].result;

  // Setup student records
  let hostelId, roomId, sidA, sidB;
  await as("authenticated", adminId, async () => {
    hostelId = (await rpc("hostel", { name: "Lotus Block", block: "L1" })).id;
    roomId = (
      await rpc("room", {
        hostel_id: hostelId,
        room_number: "101",
        floor_number: 1,
        capacity: 2,
        room_type: "Standard",
      })
    ).id;
  });

  const beds = (
    await db.query(
      "select id from beds where room_id = $1 order by bed_number",
      [roomId],
    )
  ).rows;

  const insertStudent = async (user, email, num, name) =>
    (
      await db.query(
        `insert into public.students(
           user_id, student_id, full_name, date_of_birth, gender, email,
           phone, course, branch, academic_year, semester,
           permanent_address, city, state, pincode, status
         ) values (
           $1, $2, $3, '2001-01-01', 'female', $4,
           '9999999999', 'B.Tech', 'CS', '2026-27', 3,
           'Street', 'City', 'State', '123456', 'active'
         ) returning id`,
        [user, num, name, email],
      )
    ).rows[0].id;

  sidA = await insertStudent(
    studentAId,
    "studenta@test.invalid",
    "STU-001",
    "Alice Johnson",
  );
  sidB = await insertStudent(
    studentBId,
    "studentb@test.invalid",
    "STU-002",
    "Bob Smith",
  );

  await as("authenticated", adminId, async () => {
    await rpc("transfer", { id: sidA, bed_id: beds[0].id });
    await rpc("transfer", { id: sidB, bed_id: beds[1].id });
  });

  // 1. Student Presence Initial State
  await t.test(
    "presence records initialized for registered students",
    async () => {
      const presenceA = (
        await db.query(
          "select * from public.student_presence where student_id = $1",
          [sidA],
        )
      ).rows[0];
      assert.ok(presenceA, "Presence record must exist for Student A");
      assert.equal(presenceA.status, "inside");

      const presenceB = (
        await db.query(
          "select * from public.student_presence where student_id = $1",
          [sidB],
        )
      ).rows[0];
      assert.ok(presenceB, "Presence record must exist for Student B");
      assert.equal(presenceB.status, "inside");
    },
  );

  // Helper to submit and optionally approve a leave request
  let leaveAId;
  const departureDate = new Date(Date.now() + 1800000).toISOString(); // 30m from now
  const returnDate = new Date(Date.now() + 14400000).toISOString(); // 4h from now

  await as("authenticated", studentAId, async () => {
    const res = (
      await db.query(`select public.submit_leave($1::jsonb) as res`, [
        JSON.stringify({
          request_nonce: crypto.randomUUID(),
          leave_type: "day_out",
          departure_at: departureDate,
          expected_return_at: returnDate,
          destination: "Downtown Market",
          reason: "Buying project textbooks",
          emergency_contact: "+91 9876543219",
        }),
      ])
    ).rows[0].res;
    leaveAId = res.id;
  });

  // 2. Issuance authorization and cryptographic hashing
  await t.test(
    "gate pass issuance permissions and crypto hashing",
    async () => {
      // Cannot issue pass while leave is pending
      await as("authenticated", studentAId, async () => {
        await assert.rejects(
          () =>
            db.query("select public.get_or_create_gate_pass($1)", [leaveAId]),
          /Gate pass can only be issued for approved leave requests/,
        );
      });

      // Approve leave A
      await as("authenticated", adminId, async () => {
        await db.query(
          "select public.review_leave($1, 'approved', 'Have a safe trip')",
          [leaveAId],
        );
      });

      // Student B cannot issue pass for Student A's leave
      await as("authenticated", studentBId, async () => {
        await assert.rejects(
          () =>
            db.query("select public.get_or_create_gate_pass($1)", [leaveAId]),
          /Not authorized to access gate pass/,
        );
      });

      // Student A successfully receives pass
      let passData;
      await as("authenticated", studentAId, async () => {
        passData = (
          await db.query("select public.get_or_create_gate_pass($1) as pass", [
            leaveAId,
          ])
        ).rows[0].pass;
      });

      assert.ok(passData.pass_id);
      assert.match(passData.pass_code, /^GP-\d{8}$/);
      assert.ok(passData.token, "Must return raw token to client");
      assert.equal(passData.status, "active");
      assert.equal(passData.student_name, "Alice Johnson");
      assert.equal(passData.leave_type, "day_out");
      assert.equal(passData.room_number, "101");

      // Verify DB does NOT store raw token; stores only SHA-256 hash
      const stored = (
        await db.query("select * from public.gate_passes where id = $1", [
          passData.pass_id,
        ])
      ).rows[0];
      const expectedHash = crypto
        .createHash("sha256")
        .update(passData.token)
        .digest("hex");
      assert.equal(
        stored.token_hash,
        expectedHash,
        "DB must store exact SHA-256 hash",
      );
      assert.notEqual(
        stored.token_hash,
        passData.token,
        "Raw token must never be in DB",
      );

      // Repeated call generates new raw token and updates hash
      let refreshedPass;
      await as("authenticated", studentAId, async () => {
        refreshedPass = (
          await db.query("select public.get_or_create_gate_pass($1) as pass", [
            leaveAId,
          ])
        ).rows[0].pass;
      });
      assert.equal(refreshedPass.pass_id, passData.pass_id);
      assert.equal(refreshedPass.pass_code, passData.pass_code);
      assert.notEqual(
        refreshedPass.token,
        passData.token,
        "Session token refreshed",
      );
    },
  );

  // 3. Gate Verification: Exit Scan
  let activePass;
  await as("authenticated", studentAId, async () => {
    activePass = (
      await db.query("select public.get_or_create_gate_pass($1) as pass", [
        leaveAId,
      ])
    ).rows[0].pass;
  });

  await t.test("gate scan exit verification and presence update", async () => {
    // Student or anon cannot verify scan
    await as("authenticated", studentAId, async () => {
      await assert.rejects(
        () =>
          db.query("select public.verify_gate_scan($1::jsonb)", [
            JSON.stringify({
              pass_id: activePass.pass_id,
              token: activePass.token,
              event_type: "exit",
            }),
          ]),
        /Security personnel access required/,
      );
    });

    // Guard verifying with invalid token fails
    await as("authenticated", guardId, async () => {
      await assert.rejects(
        () =>
          db.query("select public.verify_gate_scan($1::jsonb)", [
            JSON.stringify({
              pass_id: activePass.pass_id,
              token: "invalid_secret_token",
              event_type: "exit",
            }),
          ]),
        /Invalid pass token/,
      );
    });

    // Guard verifying with valid token succeeds
    let scanResult;
    const idempotencyKey = crypto.randomUUID();
    await as("authenticated", guardId, async () => {
      scanResult = (
        await db.query("select public.verify_gate_scan($1::jsonb) as res", [
          JSON.stringify({
            pass_id: activePass.pass_id,
            token: activePass.token,
            event_type: "exit",
            idempotency_key: idempotencyKey,
          }),
        ])
      ).rows[0].res;
    });

    assert.equal(scanResult.outcome, "accepted");
    assert.equal(scanResult.event_type, "exit");
    assert.equal(scanResult.student_name, "Alice Johnson");
    assert.equal(scanResult.hostel_name, "Lotus Block");
    assert.equal(scanResult.room_number, "101");

    // Verify pass is updated to 'used'
    const passRec = (
      await db.query("select * from public.gate_passes where id = $1", [
        activePass.pass_id,
      ])
    ).rows[0];
    assert.equal(passRec.status, "used");
    assert.ok(passRec.exit_used_at);

    // Verify student presence is updated to 'outside'
    const presenceRec = (
      await db.query(
        "select * from public.student_presence where student_id = $1",
        [sidA],
      )
    ).rows[0];
    assert.equal(presenceRec.status, "outside");
    assert.equal(presenceRec.active_leave_id, leaveAId);
    assert.equal(presenceRec.active_pass_id, activePass.pass_id);
    assert.ok(presenceRec.last_exit_at);

    // Verify immutable audit event logged
    const eventRec = (
      await db.query(
        "select * from public.gate_events where pass_id = $1 and event_type = 'exit'",
        [activePass.pass_id],
      )
    ).rows[0];
    assert.equal(eventRec.outcome, "accepted");
    assert.equal(eventRec.verified_by, guardId);

    // Verify idempotency
    await as("authenticated", guardId, async () => {
      const dup = (
        await db.query("select public.verify_gate_scan($1::jsonb) as res", [
          JSON.stringify({
            pass_id: activePass.pass_id,
            token: activePass.token,
            event_type: "exit",
            idempotency_key: idempotencyKey,
          }),
        ])
      ).rows[0].res;
      assert.equal(dup.duplicate, true);
    });
  });

  // 4. Single-use enforcement & replay rejection
  await t.test("single-use exit prevents replay attacks", async () => {
    await as("authenticated", guardId, async () => {
      await assert.rejects(
        () =>
          db.query("select public.verify_gate_scan($1::jsonb)", [
            JSON.stringify({
              pass_id: activePass.pass_id,
              token: activePass.token,
              event_type: "exit",
            }),
          ]),
        /Gate pass exit has already been verified/,
      );
    });
  });

  // 5. Gate Verification: Entry / Return Scan
  await t.test("gate scan entry verification and presence update", async () => {
    let entryResult;
    await as("authenticated", guardId, async () => {
      entryResult = (
        await db.query("select public.verify_gate_scan($1::jsonb) as res", [
          JSON.stringify({
            pass_code: activePass.pass_code,
            event_type: "entry",
          }),
        ])
      ).rows[0].res;
    });

    assert.equal(entryResult.outcome, "accepted");
    assert.equal(entryResult.event_type, "entry");
    assert.equal(entryResult.student_name, "Alice Johnson");
    assert.equal(entryResult.is_late, false);

    // Verify pass is completed
    const passRec = (
      await db.query("select * from public.gate_passes where id = $1", [
        activePass.pass_id,
      ])
    ).rows[0];
    assert.equal(passRec.status, "completed");
    assert.ok(passRec.entry_used_at);

    // Verify student presence returned to 'inside'
    const presenceRec = (
      await db.query(
        "select * from public.student_presence where student_id = $1",
        [sidA],
      )
    ).rows[0];
    assert.equal(presenceRec.status, "inside");
    assert.equal(presenceRec.active_leave_id, null);
    assert.equal(presenceRec.active_pass_id, null);
    assert.ok(presenceRec.last_entry_at);

    // Verify leave request completed
    const leaveRec = (
      await db.query("select * from public.leave_requests where id = $1", [
        leaveAId,
      ])
    ).rows[0];
    assert.equal(leaveRec.status, "completed");
  });

  // 6. Manual Gate Override
  await t.test(
    "manual gate override records emergency exit and entry",
    async () => {
      // Non-security rejected
      await as("authenticated", studentAId, async () => {
        await assert.rejects(
          () =>
            db.query("select public.manual_gate_override($1::jsonb)", [
              JSON.stringify({
                student_id: sidB,
                event_type: "exit",
                override_reason: "Emergency visit",
              }),
            ]),
          /Security personnel access required/,
        );
      });

      // Reason too short (<5 chars) rejected
      await as("authenticated", guardId, async () => {
        await assert.rejects(
          () =>
            db.query("select public.manual_gate_override($1::jsonb)", [
              JSON.stringify({
                student_id: sidB,
                event_type: "exit",
                override_reason: "Sick",
              }),
            ]),
          /A detailed override reason of at least 5 characters is required/,
        );
      });

      // Guard authorizes manual exit for Student B
      await as("authenticated", guardId, async () => {
        const res = (
          await db.query(
            "select public.manual_gate_override($1::jsonb) as res",
            [
              JSON.stringify({
                student_id: sidB,
                event_type: "exit",
                override_reason:
                  "Student accompanying family in campus emergency.",
              }),
            ],
          )
        ).rows[0].res;
        assert.equal(res.outcome, "accepted");
        assert.equal(res.is_manual_override, true);
      });

      let presenceB = (
        await db.query(
          "select * from public.student_presence where student_id = $1",
          [sidB],
        )
      ).rows[0];
      assert.equal(presenceB.status, "outside");

      // Guard authorizes manual return for Student B
      await as("authenticated", guardId, async () => {
        const res = (
          await db.query(
            "select public.manual_gate_override($1::jsonb) as res",
            [
              JSON.stringify({
                student_id: sidB,
                event_type: "entry",
                override_reason: "Student returned safely to campus.",
              }),
            ],
          )
        ).rows[0].res;
        assert.equal(res.outcome, "accepted");
      });

      presenceB = (
        await db.query(
          "select * from public.student_presence where student_id = $1",
          [sidB],
        )
      ).rows[0];
      assert.equal(presenceB.status, "inside");
    },
  );

  // 7. Pass Revocation by Admin
  await t.test(
    "gate pass revocation invalidates pass for scanning",
    async () => {
      // Setup another leave for Student A
      let leave2Id, pass2;
      await as("authenticated", studentAId, async () => {
        leave2Id = (
          await db.query(`select public.submit_leave($1::jsonb) as res`, [
            JSON.stringify({
              request_nonce: crypto.randomUUID(),
              leave_type: "day_out",
              departure_at: departureDate,
              expected_return_at: returnDate,
              destination: "Library",
              reason: "Exam preparation",
              emergency_contact: "+91 9876543219",
            }),
          ])
        ).rows[0].res.id;
      });

      await as("authenticated", adminId, async () => {
        await db.query(
          "select public.review_leave($1, 'approved', 'Approved')",
          [leave2Id],
        );
      });

      await as("authenticated", studentAId, async () => {
        pass2 = (
          await db.query("select public.get_or_create_gate_pass($1) as pass", [
            leave2Id,
          ])
        ).rows[0].pass;
      });

      // Guard cannot revoke pass (admin only)
      await as("authenticated", guardId, async () => {
        await assert.rejects(
          () =>
            db.query("select public.revoke_gate_pass($1, 'Violation')", [
              pass2.pass_id,
            ]),
          /Administrator access required/,
        );
      });

      // Admin revokes pass
      await as("authenticated", adminId, async () => {
        const res = (
          await db.query(
            "select public.revoke_gate_pass($1, 'Violation of campus rules') as res",
            [pass2.pass_id],
          )
        ).rows[0].res;
        assert.equal(res.status, "revoked");
      });

      // Guard attempts to verify scan -> rejected
      await as("authenticated", guardId, async () => {
        await assert.rejects(
          () =>
            db.query("select public.verify_gate_scan($1::jsonb)", [
              JSON.stringify({
                pass_id: pass2.pass_id,
                token: pass2.token,
                event_type: "exit",
              }),
            ]),
          /Gate pass has been revoked: Violation of campus rules/,
        );
      });
    },
  );

  // 8. Gate Dashboard Metrics
  await t.test(
    "gate_dashboard_metrics returns accurate aggregated metrics",
    async () => {
      let metrics;
      await as("authenticated", adminId, async () => {
        metrics = (
          await db.query("select public.gate_dashboard_metrics() as m")
        ).rows[0].m;
      });

      assert.equal(metrics.total_students, 2);
      assert.equal(metrics.students_inside, 2);
      assert.equal(metrics.students_outside, 0);
      assert.equal(metrics.overdue_count, 0);
      assert.ok(Array.isArray(metrics.recent_events));
      assert.ok(
        metrics.recent_events.length >= 2,
        "Should have recent gate events",
      );
    },
  );

  // 9. Row Level Security Isolation
  await t.test("RLS isolates student gate passes and presence", async () => {
    // Student B cannot see Student A's gate passes directly
    await as("authenticated", studentBId, async () => {
      const rows = (
        await db.query(
          "select id, pass_code, status from public.gate_passes where student_id = $1",
          [sidA],
        )
      ).rows;
      assert.equal(
        rows.length,
        0,
        "Student B must not see Student A passes via RLS",
      );
    });

    // Student A can see their own gate passes
    await as("authenticated", studentAId, async () => {
      const rows = (
        await db.query(
          "select id, pass_code, status from public.gate_passes where student_id = $1",
          [sidA],
        )
      ).rows;
      assert.ok(rows.length > 0, "Student A can see own passes");
      await assert.rejects(
        db.query("select token_hash from public.gate_passes where student_id = $1", [sidA]),
        /permission denied/i,
        "Students must not read reusable pass token digests",
      );
    });

    // Security officer can see all passes and presence
    await as("authenticated", guardId, async () => {
      const allPresence = (
        await db.query("select * from public.student_presence")
      ).rows;
      assert.equal(
        allPresence.length,
        2,
        "Security officer can see all presence records",
      );

      const allEvents = (await db.query("select * from public.gate_events"))
        .rows;
      assert.ok(
        allEvents.length >= 2,
        "Security officer can see all gate events",
      );
    });
  });

  await t.test(
    "visitor desk authorization, approval, identity verification, audit and timestamp controls",
    async () => {
      const start = new Date(Date.now() - 60_000).toISOString();
      const end = new Date(Date.now() + 30 * 60_000).toISOString();
      const payload = {
        student_id: sidA,
        visitor_full_name: "Visitor One",
        visitor_contact: "+91 98765 43210",
        visit_purpose: "Family visit",
        scheduled_entry_at: start,
        scheduled_exit_at: end,
        visitor_count: 1,
        entered_at: "2000-01-01T00:00:00.000Z",
        government_id_verified: true,
      };

      await as("authenticated", studentAId, async () => {
        await assert.rejects(
          db.query("select public.visitor_register($1::jsonb)", [
            JSON.stringify(payload),
          ]),
          /Active security or administrator access required/i,
        );
        await assert.rejects(
          db.query("select public.visitor_check_in($1)", [
            "10000000-0000-4000-8000-000000000001",
          ]),
          /Active security or administrator access required/i,
        );
      });

      let visitId;
      await as("authenticated", guardId, async () => {
        const matches = (
          await db.query(
            "select public.visitor_student_search('STU-001') result",
          )
        ).rows[0].result;
        assert.equal(matches.length, 1);
        assert.equal(matches[0].registration_id, "STU-001");
        assert.equal(Object.hasOwn(matches[0], "phone"), false);
        await assert.rejects(
          db.query("select public.visitor_register($1::jsonb)", [
            JSON.stringify({ ...payload, visitor_count: -1 }),
          ]),
          /visitor_count_check/i,
        );

        const created = (
          await db.query("select public.visitor_register($1::jsonb) result", [
            JSON.stringify(payload),
          ])
        ).rows[0].result;
        visitId = created.id;
        assert.equal(created.status, "pending");
        assert.equal(created.approval_status, "pending");

        await assert.rejects(
          db.query("select * from public.visitor_visits where id=$1", [
            visitId,
          ]),
          /permission denied/i,
        );
        await assert.rejects(
          db.query("select public.visitor_decide($1,'approved',null)", [
            visitId,
          ]),
          /Active administrator or warden access required/i,
        );
        await assert.rejects(
          db.query("select public.visitor_check_in($1)", [visitId]),
          /not approved/i,
        );
      });

      await as("authenticated", wardenId, async () => {
        const decision = (
          await db.query(
            "select public.visitor_decide($1,'approved',null) result",
            [visitId],
          )
        ).rows[0].result;
        assert.equal(decision.status, "approved");
        await assert.rejects(
          db.query("select public.visitor_check_in($1)", [visitId]),
          /Active security or administrator access required/i,
        );
      });

      await as("authenticated", guardId, async () => {
        await assert.rejects(
          db.query("select public.visitor_check_in($1)", [visitId]),
          /Verify the visitor identity/i,
        );
        const verified = (
          await db.query("select public.visitor_verify_identity($1) result", [
            visitId,
          ])
        ).rows[0].result;
        assert.ok(verified.identity_verified_at);
        const checkedIn = (
          await db.query("select public.visitor_check_in($1) result", [visitId])
        ).rows[0].result;
        assert.ok(checkedIn.entered_at);
        assert.notEqual(checkedIn.entered_at, payload.entered_at);
        await assert.rejects(
          db.query("select public.visitor_check_in($1)", [visitId]),
          /not approved or already checked in/i,
        );
        const checkedOut = (
          await db.query("select public.visitor_check_out($1) result", [
            visitId,
          ])
        ).rows[0].result;
        assert.ok(checkedOut.exited_at);
        await assert.rejects(
          db.query("select public.visitor_check_out($1)", [visitId]),
          /Only a checked-in visitor/i,
        );
      });

      await as("authenticated", studentAId, async () => {
        const own = (
          await db.query(
            "select public.visitor_list('',null,null,'','','0','25') result",
          )
        ).rows[0].result;
        assert.equal(own.count, 1);
        assert.equal(own.rows[0].visitor_contact, null);
        assert.equal(own.rows[0].status, "checked_out");
        assert.ok(
          own.rows[0].events.some((event) => event.event_type === "checked_in"),
        );
      });

      await as("authenticated", studentBId, async () => {
        const others = (
          await db.query(
            "select public.visitor_list('',null,null,'','','0','25') result",
          )
        ).rows[0].result;
        assert.equal(others.count, 0);
      });

      await as("authenticated", guardId, async () => {
        const rows = (
          await db.query(
            "select public.visitor_list('',null,null,'','','0','25') result",
          )
        ).rows[0].result;
        assert.equal(rows.count, 1);
        assert.equal(rows.rows[0].visitor_contact, payload.visitor_contact);
        assert.ok(rows.rows[0].government_id_verified);
      });
    },
  );

  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261103151402_dedicated_security_guard_gate_verification.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  await as("authenticated", guardId, async () => {
    const profile = (await db.query("select role from public.profiles where id=$1", [guardId])).rows[0];
    assert.equal(profile.role, "security_guard");
    const events = await db.query("select * from public.gate_events");
    assert.equal(events.rows.length, 0, "guards cannot read the broad gate audit table");
    await assert.rejects(
      db.query("select public.record_gate_movement(null,null,null,null,null,null,null)"),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("select public.verify_gate_scan('{}'::jsonb)"),
      /permission denied/i,
    );
  });

  await as("authenticated", adminId, async () => {
    const metrics = await db.query("select public.gate_dashboard_metrics() result");
    assert.ok(metrics.rows[0].result);
  });
});
