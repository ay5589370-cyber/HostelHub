import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Phase 3 leave management database policies, transactions and constraints", async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 create publication supabase_realtime;`);

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
        "../supabase/migrations/20261025150000_phase10_notifications.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  const admin = "00000000-0000-4000-8000-000000000001";
  const studentA = "00000000-0000-4000-8000-000000000002";
  const studentB = "00000000-0000-4000-8000-000000000003";
  const warden = "00000000-0000-4000-8000-000000000004";

  await db.query(
    `insert into auth.users(id,email) values($1,'admin@test.invalid'),($2,'a@test.invalid'),($3,'b@test.invalid'),($4,'w@test.invalid')`,
    [admin, studentA, studentB, warden],
  );
  await db.query(
    `update public.profiles set role=case when id=$1 then 'admin' when id=$2 then 'warden' else 'student' end`,
    [admin, warden],
  );

  const as = async (role, id, fn) => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
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
      await db.query("select public.manage_phase2($1,$2::jsonb) as result", [
        action,
        JSON.stringify(data),
      ])
    ).rows[0].result;

  // Setup hostel, room, bed, and active allocations
  let hostelId, roomId, bedA, bedB, sidA, sidB;
  await as("authenticated", admin, async () => {
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
    await db.query("select id from beds where room_id=$1 order by bed_number", [
      roomId,
    ])
  ).rows;
  bedA = beds[0].id;
  bedB = beds[1].id;

  const insertStudent = async (user, email, num) =>
    (
      await db.query(
        `insert into students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode) values($1,$2,'Test student','2001-01-01','other',$3,'9999999999','B.Tech','CS','2026',2,'Street','City','State','123456') returning id`,
        [user, num, email],
      )
    ).rows[0].id;

  sidA = await insertStudent(studentA, "a@test.invalid", "STU001");
  sidB = await insertStudent(studentB, "b@test.invalid", "STU002");

  await as("authenticated", admin, async () => {
    await rpc("transfer", { id: sidA, bed_id: bedA });
    await rpc("transfer", { id: sidB, bed_id: bedB });
  });

  // 1. Submit valid Day-Out request
  let dayOutId, dayOutNumber;
  await t.test("1. Student can submit valid Day-Out request", async () => {
    await as("authenticated", studentA, async () => {
      const payload = {
        request_nonce: "20000000-0000-4000-8000-000000000001",
        leave_type: "day_out",
        departure_at: "2030-05-10T08:00:00.000Z",
        expected_return_at: "2030-05-10T16:00:00.000Z",
        destination: "Central Market",
        reason: "Personal shopping and book purchase",
        emergency_contact: "+91 9876543210",
      };
      const res = (
        await db.query("select public.submit_leave($1::jsonb) res", [
          JSON.stringify(payload),
        ])
      ).rows[0].res;
      assert.ok(res.id);
      assert.match(res.request_number, /^LVR-\d{4}-\d{6}$/);
      assert.equal(res.duplicate, false);
      assert.equal(res.student_id, sidA);
      dayOutId = res.id;
      dayOutNumber = res.request_number;

      const row = (
        await db.query("select * from leave_requests where id=$1", [dayOutId])
      ).rows[0];
      assert.equal(row.request_number, dayOutNumber);
      assert.equal(row.status, "pending");
      assert.equal(row.leave_type, "day_out");
      assert.equal(row.destination, "Central Market");
    });
  });

  // 2. Submit valid Night-Out request
  let nightOutId;
  await t.test("2. Student can submit valid Night-Out request", async () => {
    await as("authenticated", studentB, async () => {
      const payload = {
        request_nonce: "20000000-0000-4000-8000-000000000002",
        leave_type: "night_out",
        departure_at: "2030-05-15T18:00:00.000Z",
        expected_return_at: "2030-05-17T18:00:00.000Z", // 48h <= 72h policy
        destination: "Family Hometown",
        reason: "Attending family wedding ceremony",
        emergency_contact: "9876543210",
      };
      const res = (
        await db.query("select public.submit_leave($1::jsonb) res", [
          JSON.stringify(payload),
        ])
      ).rows[0].res;
      assert.ok(res.id);
      assert.equal(res.duplicate, false);
      assert.equal(res.student_id, sidB);
      nightOutId = res.id;

      const row = (
        await db.query(
          "select status, leave_type from leave_requests where id=$1",
          [nightOutId],
        )
      ).rows[0];
      assert.equal(row.status, "pending");
      assert.equal(row.leave_type, "night_out");
    });
  });

  // 3. Missing or too-short destination or reason is rejected
  await t.test("3. Missing destination or reason is rejected", async () => {
    await as("authenticated", studentA, async () => {
      // Short destination (< 2 chars)
      await assert.rejects(
        db.query("select public.submit_leave($1::jsonb)", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000003",
            leave_type: "day_out",
            departure_at: "2030-06-01T08:00:00.000Z",
            expected_return_at: "2030-06-01T14:00:00.000Z",
            destination: "a",
            reason: "Valid explanation here",
            emergency_contact: "9876543210",
          }),
        ]),
        /check constraint/i,
      );

      // Short reason (< 5 chars)
      await assert.rejects(
        db.query("select public.submit_leave($1::jsonb)", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000004",
            leave_type: "day_out",
            departure_at: "2030-06-01T08:00:00.000Z",
            expected_return_at: "2030-06-01T14:00:00.000Z",
            destination: "Library",
            reason: "no",
            emergency_contact: "9876543210",
          }),
        ]),
        /check constraint/i,
      );
    });
  });

  // 4. Invalid departure/return times (departure >= expected_return) rejected
  await t.test("4. Invalid departure/return times are rejected", async () => {
    await as("authenticated", studentA, async () => {
      await assert.rejects(
        db.query("select public.submit_leave($1::jsonb)", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000005",
            leave_type: "day_out",
            departure_at: "2030-06-01T18:00:00.000Z",
            expected_return_at: "2030-06-01T10:00:00.000Z",
            destination: "Library",
            reason: "Valid explanation here",
            emergency_contact: "9876543210",
          }),
        ]),
        /precede expected return|check constraint/i,
      );
    });
  });

  // 5. Past departure dates rejected
  await t.test(
    "5. Past departure dates are rejected according to policy",
    async () => {
      await as("authenticated", studentA, async () => {
        await assert.rejects(
          db.query("select public.submit_leave($1::jsonb)", [
            JSON.stringify({
              request_nonce: "20000000-0000-4000-8000-000000000006",
              leave_type: "day_out",
              departure_at: "2020-01-01T08:00:00.000Z",
              expected_return_at: "2020-01-01T14:00:00.000Z",
              destination: "Library",
              reason: "Valid explanation here",
              emergency_contact: "9876543210",
            }),
          ]),
          /Departure must be in the future/i,
        );
      });
    },
  );

  // 6. Disallowed durations rejected (Day-Out > 16h, Night-Out > 72h)
  await t.test("6. Disallowed durations are rejected", async () => {
    await as("authenticated", studentA, async () => {
      // Day-out for 22 hours (> 16 hours default policy)
      await assert.rejects(
        db.query("select public.submit_leave($1::jsonb)", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000007",
            leave_type: "day_out",
            departure_at: "2030-06-01T06:00:00.000Z",
            expected_return_at: "2030-06-02T04:00:00.000Z", // 22 hours
            destination: "City Tour",
            reason: "Full day and night tour",
            emergency_contact: "9876543210",
          }),
        ]),
        /Leave duration exceeds hostel policy/i,
      );

      // Night-out for 5 days (> 72 hours default policy)
      await assert.rejects(
        db.query("select public.submit_leave($1::jsonb)", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000008",
            leave_type: "night_out",
            departure_at: "2030-06-01T08:00:00.000Z",
            expected_return_at: "2030-06-06T08:00:00.000Z", // 120 hours
            destination: "Hometown Vacation",
            reason: "Long family vacation",
            emergency_contact: "9876543210",
          }),
        ]),
        /Leave duration exceeds hostel policy/i,
      );
    });
  });

  // 7. Conflicting requests are handled correctly
  await t.test("7. Conflicting requests are handled correctly", async () => {
    await as("authenticated", studentA, async () => {
      // dayOutId is on 2030-05-10 from 08:00 to 16:00
      await assert.rejects(
        db.query("select public.submit_leave($1::jsonb)", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000009",
            leave_type: "day_out",
            departure_at: "2030-05-10T12:00:00.000Z", // overlaps!
            expected_return_at: "2030-05-10T15:00:00.000Z",
            destination: "Dentist Clinic",
            reason: "Dental appointment overlap",
            emergency_contact: "9876543210",
          }),
        ]),
        /conflicts with an active request/i,
      );
    });
  });

  // 8. Student cannot access another student's requests
  await t.test(
    "8. A student cannot access another student requests",
    async () => {
      await as("authenticated", studentB, async () => {
        // studentB should NOT see studentA's dayOutId
        const visible = (
          await db.query("select * from leave_requests where id=$1", [dayOutId])
        ).rows;
        assert.equal(visible.length, 0);

        // studentB should only see own requests
        const allMine = (await db.query("select * from leave_requests")).rows;
        assert.equal(allMine.length, 1);
        assert.equal(allMine[0].id, nightOutId);
      });
    },
  );

  // 9. Student cannot approve or reject request through direct API calls
  await t.test(
    "9. A student cannot approve or reject a request through direct API calls",
    async () => {
      await as("authenticated", studentA, async () => {
        // Direct UPDATE fails due to no grant / RLS
        await assert.rejects(
          db.query("update leave_requests set status='approved' where id=$1", [
            dayOutId,
          ]),
          /permission denied/i,
        );

        // Direct call to review_leave fails
        await assert.rejects(
          db.query(
            "select public.review_leave($1, 'approved', 'Self approval')",
            [dayOutId],
          ),
          /Administrator access required/i,
        );
      });
    },
  );

  // 10. Unauthorized users cannot review requests
  await t.test("10. Unauthorized users cannot review requests", async () => {
    await as("authenticated", warden, async () => {
      await assert.rejects(
        db.query(
          "select public.review_leave($1, 'approved', 'Warden attempt')",
          [dayOutId],
        ),
        /Administrator access required/i,
      );
    });
    await as("anon", null, async () => {
      await assert.rejects(
        db.query("select public.review_leave($1, 'approved', null)", [
          dayOutId,
        ]),
        /permission denied/i,
      );
    });
  });

  // 11. Only valid state transitions succeed
  await t.test("11. Only valid state transitions succeed", async () => {
    // Student can cancel pending
    await as("authenticated", studentB, async () => {
      const cancelRes = (
        await db.query("select public.cancel_leave($1) res", [nightOutId])
      ).rows[0].res;
      assert.equal(cancelRes.status, "cancelled");

      // Cannot cancel an already cancelled request
      await assert.rejects(
        db.query("select public.cancel_leave($1)", [nightOutId]),
        /Only pending leave requests can be cancelled/i,
      );
    });

    // Admin approves dayOutId
    await as("authenticated", admin, async () => {
      const reviewRes = (
        await db.query(
          "select public.review_leave($1, 'approved', 'Approved for shopping') res",
          [dayOutId],
        )
      ).rows[0].res;
      assert.equal(reviewRes.status, "approved");

      // Cannot approve already approved request
      await assert.rejects(
        db.query("select public.review_leave($1, 'approved', 'Again')", [
          dayOutId,
        ]),
        /already been decided/i,
      );
    });

    // Student cannot cancel an approved request
    await as("authenticated", studentA, async () => {
      await assert.rejects(
        db.query("select public.cancel_leave($1)", [dayOutId]),
        /Only pending leave requests can be cancelled/i,
      );
    });
  });

  // 12. Concurrent approval/rejection attempts handled safely
  await t.test(
    "12. Concurrent approval/rejection attempts are handled safely",
    async () => {
      // Create fresh pending request
      let testReqId;
      await as("authenticated", studentA, async () => {
        const res = (
          await db.query("select public.submit_leave($1::jsonb) res", [
            JSON.stringify({
              request_nonce: "20000000-0000-4000-8000-000000000010",
              leave_type: "day_out",
              departure_at: "2030-07-01T08:00:00.000Z",
              expected_return_at: "2030-07-01T16:00:00.000Z",
              destination: "Museum",
              reason: "Educational field visit",
              emergency_contact: "9876543210",
            }),
          ])
        ).rows[0].res;
        testReqId = res.id;
      });

      // First review succeeds
      await as("authenticated", admin, async () => {
        await db.query(
          "select public.review_leave($1, 'approved', 'Valid reason')",
          [testReqId],
        );
      });

      // Second concurrent attempt encounters updated status and fails cleanly
      await as("authenticated", admin, async () => {
        await assert.rejects(
          db.query("select public.review_leave($1, 'rejected', 'Too late')", [
            testReqId,
          ]),
          /already been decided/i,
        );
      });
    },
  );

  // 13. Rejection requires a reason
  await t.test("13. Rejection requires a reason", async () => {
    let freshReqId;
    await as("authenticated", studentB, async () => {
      const res = (
        await db.query("select public.submit_leave($1::jsonb) res", [
          JSON.stringify({
            request_nonce: "20000000-0000-4000-8000-000000000011",
            leave_type: "day_out",
            departure_at: "2030-08-01T08:00:00.000Z",
            expected_return_at: "2030-08-01T16:00:00.000Z",
            destination: "Mall",
            reason: "Weekend relaxation",
            emergency_contact: "9876543210",
          }),
        ])
      ).rows[0].res;
      freshReqId = res.id;
    });

    await as("authenticated", admin, async () => {
      // Empty remarks fails
      await assert.rejects(
        db.query("select public.review_leave($1, 'rejected', '')", [
          freshReqId,
        ]),
        /rejection reason is required/i,
      );
      // Whitespace remarks fails
      await assert.rejects(
        db.query("select public.review_leave($1, 'rejected', '   ')", [
          freshReqId,
        ]),
        /rejection reason is required/i,
      );
      // Valid remarks succeeds
      const rejRes = (
        await db.query(
          "select public.review_leave($1, 'rejected', 'Exams scheduled this week') res",
          [freshReqId],
        )
      ).rows[0].res;
      assert.equal(rejRes.status, "rejected");
    });
  });

  // 14. Document access follows Storage authorization policies
  await t.test(
    "14. Document access follows Storage authorization policies",
    async () => {
      let pendingReqId;
      await as("authenticated", studentA, async () => {
        const res = (
          await db.query("select public.submit_leave($1::jsonb) res", [
            JSON.stringify({
              request_nonce: "20000000-0000-4000-8000-000000000012",
              leave_type: "day_out",
              departure_at: "2030-09-01T08:00:00.000Z",
              expected_return_at: "2030-09-01T16:00:00.000Z",
              destination: "Conference",
              reason: "Attending robotics conference",
              emergency_contact: "9876543210",
            }),
          ])
        ).rows[0].res;
        pendingReqId = res.id;
      });

      const docUuid = "30000000-0000-4000-8000-000000000001";
      const validPath = `${sidA}/${pendingReqId}/${docUuid}.pdf`;
      const invalidStudentPath = `${sidB}/${pendingReqId}/${docUuid}.pdf`;

      await as("authenticated", studentA, async () => {
        // Student A can insert storage object under own student/request path
        await db.query(
          "insert into storage.objects(bucket_id, name) values('leave-documents', $1)",
          [validPath],
        );

        // Student A registers metadata
        const docId = (
          await db.query(
            "select public.register_leave_document($1, $2, $3, $4, $5) doc_id",
            [
              pendingReqId,
              validPath,
              "invitation.pdf",
              "application/pdf",
              1024 * 50,
            ],
          )
        ).rows[0].doc_id;
        assert.ok(docId);

        // Student A cannot insert storage object under another student folder
        await assert.rejects(
          db.query(
            "insert into storage.objects(bucket_id, name) values('leave-documents', $1)",
            [invalidStudentPath],
          ),
          /row-level security/i,
        );
      });

      // Student B cannot read Student A's storage object
      await as("authenticated", studentB, async () => {
        const visible = (
          await db.query("select * from storage.objects where name=$1", [
            validPath,
          ])
        ).rows;
        assert.equal(visible.length, 0);

        const docsVisible = (
          await db.query(
            "select * from leave_request_documents where object_path=$1",
            [validPath],
          )
        ).rows;
        assert.equal(docsVisible.length, 0);
      });

      // Admin can read Student A's storage object
      await as("authenticated", admin, async () => {
        const visible = (
          await db.query("select * from storage.objects where name=$1", [
            validPath,
          ])
        ).rows;
        assert.equal(visible.length, 1);
      });
    },
  );

  // 15. Dashboard counts come from actual database queries
  await t.test(
    "15. Dashboard counts come from actual database queries",
    async () => {
      await as("authenticated", admin, async () => {
        const dash = (await db.query("select public.phase3_dashboard() dash"))
          .rows[0].dash;
        assert.ok(typeof dash.pending === "number");
        assert.ok(typeof dash.approved === "number");
        assert.ok(typeof dash.upcoming === "number");
        assert.ok(typeof dash.overdue === "number");
        assert.ok(Array.isArray(dash.recent_decisions));
        assert.ok(dash.pending >= 1);
        assert.ok(dash.approved >= 1);
        assert.ok(dash.recent_decisions.length >= 1);
      });
    },
  );

  // 16. Existing authentication, student management, and room management continues to work
  await t.test(
    "16. Existing authentication, student management, and room management continues to work",
    async () => {
      await as("authenticated", admin, async () => {
        const directory = (await db.query("select * from student_directory"))
          .rows;
        assert.equal(directory.length, 2);
        const rooms = (
          await db.query("select * from rooms where id=$1", [roomId])
        ).rows;
        assert.equal(rooms.length, 1);
        assert.equal(rooms[0].capacity, 2);
        const dash2 = (await db.query("select public.phase2_dashboard() dash"))
          .rows[0].dash;
        assert.equal(dash2.students, 2);
        assert.equal(dash2.occupied, 2);
      });
    },
  );

  await t.test(
    "17. Leave notifications are visible and markable only by their recipient",
    async () => {
      const recipientNotice = (
        await db.query(
          "select id from notifications where recipient_user_id=$1 and event_type='leave_approved' limit 1",
          [studentA],
        )
      ).rows[0];
      assert.ok(recipientNotice?.id);

      await as("authenticated", studentB, async () => {
        const otherRows = (
          await db.query("select id from notifications where id=$1", [
            recipientNotice.id,
          ])
        ).rows;
        assert.equal(otherRows.length, 0);
        const changed = await db.query(
          "update notifications set read_at=now() where id=$1 returning id",
          [recipientNotice.id],
        );
        assert.equal(changed.rows.length, 0);
      });

      await as("authenticated", studentA, async () => {
        const changed = await db.query(
          "update notifications set read_at=now() where id=$1 returning id,delivery_status",
          [recipientNotice.id],
        );
        assert.equal(changed.rows.length, 1);
        assert.equal(changed.rows[0].delivery_status, "in_app_created");
      });
    },
  );

  await t.test(
    "18. Active admins publish duplicate-safe in-app announcements to active students",
    async () => {
      await as("authenticated", studentA, async () => {
        await assert.rejects(
          db.query(
            "select public.hostel_announcement_save(null,'Title','Message','draft')",
          ),
          /Active administrator access required/i,
        );
        await assert.rejects(
          db.query("select public.hostel_announcement_list(0,20)"),
          /Active administrator access required/i,
        );
      });

      let announcementId;
      await as("authenticated", admin, async () => {
        const draft = (
          await db.query(
            "select public.hostel_announcement_save(null,'Water maintenance','Water will be unavailable from 10:00 to 11:00.','draft') result",
          )
        ).rows[0].result;
        announcementId = draft.id;
        assert.equal(draft.status, "draft");

        const listed = (
          await db.query("select public.hostel_announcement_list(0,20) result")
        ).rows[0].result;
        assert.equal(listed.total, 1);
        assert.equal(listed.rows[0].recipient_count, 0);

        const published = (
          await db.query(
            "select public.hostel_announcement_save($1,'Water maintenance','Water will be unavailable from 10:00 to 11:00.','publish') result",
            [announcementId],
          )
        ).rows[0].result;
        assert.equal(published.status, "published");
        assert.equal(published.recipients_created, 2);
        const retry = (
          await db.query(
            "select public.hostel_announcement_save($1,'Water maintenance','Retry','publish') result",
            [announcementId],
          )
        ).rows[0].result;
        assert.equal(retry.already_published, true);
        assert.equal(retry.recipients_created, 0);
        assert.equal(retry.recipients_total, 2);
        assert.equal(
          (
            await db.query(
              "select (public.hostel_announcement_list(0,20)->'rows'->0->>'recipient_count')::int n",
            )
          ).rows[0].n,
          2,
        );
      });

      const announcementNotice = (
        await db.query(
          "select id from announcement_notifications where announcement_id=$1 and recipient_user_id=$2",
          [announcementId, studentA],
        )
      ).rows[0];
      assert.ok(announcementNotice?.id);

      await as("authenticated", studentB, async () => {
        assert.equal(
          (
            await db.query(
              "select id from announcement_notifications where id=$1",
              [announcementNotice.id],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "update announcement_notifications set read_at=now() where id=$1 returning id",
              [announcementNotice.id],
            )
          ).rows.length,
          0,
        );
      });
      await as("authenticated", studentA, async () => {
        assert.equal(
          (
            await db.query(
              "update announcement_notifications set read_at=now() where id=$1 returning id",
              [announcementNotice.id],
            )
          ).rows.length,
          1,
        );
      });
    },
  );

  await db.close();
});
