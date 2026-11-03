import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("registration migration chain, transactions and access policies on PostgreSQL", async (t) => {
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
        "../supabase/migrations/20261024120000_phase5_student_admission_fields.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261027100000_temporary_student_credentials.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261029140000_student_registration_id_drift_repair.sql",
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
        "../supabase/migrations/20261030210000_first_login_password_setup.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261030220000_harden_profiles_rls.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const admin = "00000000-0000-4000-8000-000000000001";
  const student = "00000000-0000-4000-8000-000000000002";
  const other = "00000000-0000-4000-8000-000000000003";
  const warden = "00000000-0000-4000-8000-000000000004";
  await db.query(
    `insert into auth.users(id,email) values($1,'admin@test.invalid'),($2,'s@test.invalid'),($3,'o@test.invalid'),($4,'w@test.invalid')`,
    [admin, student, other, warden],
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
  await t.test(
    "first-login password setup can only clear the signed-in student's flag",
    async () => {
      await db.query(
        "update profiles set must_change_password=true where id=$1",
        [student],
      );
      await db.query(
        "update profiles set must_change_password=true where id=$1",
        [admin],
      );
      await db.query(
        `insert into public.student_registrations(id, requested_by, payload, email, student_number, auth_user_id, invitation_status)
         values('00000000-0000-4000-8000-000000000099', $1, '{"full_name":"Test Student"}'::jsonb, 's@test.invalid', 'HH-00000099', $2, 'credentials_ready')
         on conflict (auth_user_id) do update set invitation_status = 'credentials_ready'`,
        [admin, student],
      );

      // Authenticated users cannot invoke complete_student_password_setup directly
      await assert.rejects(
        as("authenticated", student, async () => {
          await db.query("select complete_student_password_setup($1)", [student]);
        }),
      );

      // service_role can invoke it and clears flag while updating invitation_status to password_set
      await as("service_role", null, async () => {
        await db.query("select complete_student_password_setup($1)", [student]);
      });

      assert.equal(
        (
          await db.query(
            "select must_change_password from profiles where id=$1",
            [student],
          )
        ).rows[0].must_change_password,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select invitation_status from student_registrations where auth_user_id=$1",
            [student],
          )
        ).rows[0].invitation_status,
        "password_set",
      );
      assert.equal(
        (
          await db.query(
            "select must_change_password from profiles where id=$1",
            [admin],
          )
        ).rows[0].must_change_password,
        true,
      );
      await assert.rejects(
        as("service_role", null, async () => {
          await db.query("select complete_student_password_setup($1)", [admin]);
        }),
      );

      // Clean up test registration so subsequent tests are unaffected
      await db.query("delete from public.student_registrations where id='00000000-0000-4000-8000-000000000099'");
    },
  );
  let hostel, room, bed, sid, oid;
  await t.test(
    "student IDs are reserved uniquely and reused for the same request",
    async () => {
      await db.query(
        `insert into student_registrations(id,requested_by,payload,email,student_number)
         values ('00000000-0000-4000-8000-000000000006',$1,'{}','legacy-id@test.invalid','HH-00000001')`,
        [admin],
      );
      await as("service_role", null, async () => {
        const reserve = async (requestId) =>
          (
            await db.query("select reserve_registration_student_id($1) id", [
              requestId,
            ])
          ).rows[0].id;
        const first = await reserve("00000000-0000-4000-8000-000000000007");
        const second = await reserve("00000000-0000-4000-8000-000000000008");
        assert.equal(first, "HH-00000002");
        assert.equal(second, "HH-00000003");
        assert.equal(
          await reserve("00000000-0000-4000-8000-000000000007"),
          first,
        );
      });
    },
  );
  await t.test(
    "admin creates a room and generates beds atomically",
    async () => {
      await as("authenticated", admin, async () => {
        hostel = (await rpc("hostel", { name: "Test hostel", block: "A" })).id;
        room = (
          await rpc("room", {
            hostel_id: hostel,
            room_number: "101",
            floor_number: 0,
            capacity: 2,
            room_type: "Standard",
          })
        ).id;
      });
      const beds = (
        await db.query(
          "select id from beds where room_id=$1 order by bed_number",
          [room],
        )
      ).rows;
      assert.equal(beds.length, 2);
      bed = beds[0].id;
    },
  );
  const insertStudent = async (user, email, num) =>
    (
      await db.query(
        `insert into students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode) values($1,$2,'Test student','2000-01-01','other',$3,'9999999999','Course','Branch','2026',1,'Address','City','State','123456') returning id`,
        [user, num, email],
      )
    ).rows[0].id;
  sid = await insertStudent(student, "s@test.invalid", "S001");
  oid = await insertStudent(other, "o@test.invalid", "S002");
  await db.query(
    `insert into guardians(student_id,full_name,relationship,phone,emergency_contact) values($1,'Guardian','Parent','9999999999','9999999999')`,
    [sid],
  );
  await t.test(
    "one active allocation per bed and student, capacity enforced",
    async () => {
      await as("authenticated", admin, () =>
        rpc("transfer", { id: sid, bed_id: bed }),
      );
      await assert.rejects(
        db.query(
          `insert into bed_allocations(student_id,bed_id) values($1,$2)`,
          [oid, bed],
        ),
        /allocation_one_bed/,
      );
      await assert.rejects(
        db.query(
          `insert into bed_allocations(student_id,bed_id) select $1,id from beds where id<>$2`,
          [sid, bed],
        ),
        /allocation_one_student/,
      );
      await assert.rejects(
        db.query(`insert into beds(room_id,bed_number) values($1,'3')`, [room]),
        /capacity exceeded/,
      );
      await assert.rejects(
        db.query(`update rooms set capacity=1 where id=$1`, [room]),
        /configured bed count/,
      );
    },
  );
  await t.test(
    "student isolation, field restrictions, directory view, guardian privacy and private files",
    async () => {
      await as("authenticated", student, async () => {
        assert.equal((await db.query("select * from students")).rows.length, 1);
        assert.equal(
          (await db.query("select * from guardians")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("select * from student_directory")).rows.length,
          1,
        );
        assert.equal((await db.query("select * from rooms")).rows.length, 1);
        await db.query(`update students set phone='8888888888' where id=$1`, [
          sid,
        ]);
        await assert.rejects(
          db.query(`update students set student_id='HACK' where id=$1`, [sid]),
          /permission denied/,
        );
        await assert.rejects(
          db.query(`update profiles set role='admin' where id=$1`, [student]),
          /permission denied/,
        );
        await assert.rejects(
          rpc("status", { id: sid, status: "archived" }),
          /Administrator access/,
        );
        await db.query(
          `insert into storage.objects(bucket_id,name) values('student-avatars',$1)`,
          [`${sid}/photo.png`],
        );
        await assert.rejects(
          db.query(
            `insert into storage.objects(bucket_id,name) values('student-avatars',$1)`,
            [`${oid}/photo.png`],
          ),
          /row-level security/,
        );
        await assert.rejects(
          db.query(`update students set profile_photo_path=$1 where id=$2`, [
            `${oid}/photo.png`,
            sid,
          ]),
          /check constraint/,
        );
      });
      await as("authenticated", other, async () => {
        assert.equal(
          (await db.query("select * from guardians")).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select * from storage.objects")).rows.length,
          0,
        );
      });
    },
  );
  await t.test(
    "leave requests isolate students and enforce trusted status transitions",
    async () => {
      const firstPayload = {
        request_nonce: "10000000-0000-4000-8000-000000000001",
        leave_type: "day_out",
        departure_at: "2030-01-10T08:00:00.000Z",
        expected_return_at: "2030-01-10T16:00:00.000Z",
        destination: "Family home",
        reason: "Scheduled family visit",
        emergency_contact: "9999999999",
      };
      let first;
      await as("authenticated", student, async () => {
        first = (
          await db.query("select public.submit_leave($1::jsonb) result", [
            JSON.stringify(firstPayload),
          ])
        ).rows[0].result;
        assert.match(first.request_number, /^LVR-\d{4}-\d{6}$/);
        const retry = (
          await db.query("select public.submit_leave($1::jsonb) result", [
            JSON.stringify(firstPayload),
          ])
        ).rows[0].result;
        assert.equal(retry.id, first.id);
        assert.equal(retry.duplicate, true);
        await assert.rejects(
          db.query("select public.submit_leave($1::jsonb)", [
            JSON.stringify({
              ...firstPayload,
              request_nonce: "10000000-0000-4000-8000-000000000002",
              departure_at: "2030-01-10T09:00:00.000Z",
            }),
          ]),
          /conflicts with an active request/,
        );
      });
      await as("authenticated", other, async () => {
        assert.equal(
          (await db.query("select * from leave_requests")).rows.length,
          0,
        );
        await assert.rejects(
          db.query("select public.review_leave($1,'approved',null)", [
            first.id,
          ]),
          /Administrator access/,
        );
      });
      await as("authenticated", admin, async () => {
        await assert.rejects(
          db.query("select public.review_leave($1,'rejected','')", [first.id]),
          /rejection reason/,
        );
        const rejection = (
          await db.query(
            "select public.review_leave($1,'rejected','Insufficient notice') result",
            [first.id],
          )
        ).rows[0].result;
        assert.equal(rejection.status, "rejected");
      });
      await as("authenticated", student, async () => {
        const row = (
          await db.query(
            "select status,reviewed_by from leave_requests where id=$1",
            [first.id],
          )
        ).rows[0];
        assert.equal(row.status, "rejected");
        assert.equal(row.reviewed_by, admin);
        assert.equal(
          (
            await db.query(
              "select * from leave_request_history where leave_request_id=$1",
              [first.id],
            )
          ).rows.length,
          2,
        );
      });
    },
  );
  await t.test(
    "warden and anonymous users cannot manage or read students",
    async () => {
      await as("authenticated", warden, async () => {
        assert.equal((await db.query("select * from students")).rows.length, 0);
        await assert.rejects(
          rpc("hostel", { name: "Bad", block: "A" }),
          /Administrator/,
        );
      });
      await as("anon", null, async () => {
        await assert.rejects(
          db.query("select * from students"),
          /permission denied/,
        );
        await assert.rejects(rpc("hostel", {}), /permission denied/);
      });
    },
  );
  await t.test(
    "failed transfer retains previous bed; maintenance rejects new allocation",
    async () => {
      const second = (await db.query("select id from beds where id<>$1", [bed]))
        .rows[0].id;
      await as("authenticated", admin, () =>
        rpc("transfer", { id: oid, bed_id: second }),
      );
      await as("authenticated", admin, async () => {
        await assert.rejects(
          rpc("transfer", { id: sid, bed_id: second }),
          /allocation_one_bed/,
        );
      });
      assert.equal(
        (
          await db.query(
            `select bed_id from bed_allocations where student_id=$1 and status='active'`,
            [sid],
          )
        ).rows[0].bed_id,
        bed,
      );
      await as("authenticated", admin, () =>
        rpc("room_update", { id: room, capacity: 3, status: "maintenance" }),
      );
      const third = (await db.query(`select id from beds where bed_number='3'`))
        .rows[0].id;
      await as("authenticated", admin, async () => {
        await assert.rejects(
          rpc("transfer", { id: sid, bed_id: third }),
          /unavailable/,
        );
        await rpc("room_update", {
          id: room,
          capacity: 3,
          status: "available",
        });
        await rpc("transfer", { id: sid, bed_id: third });
      });
      assert.equal(
        (
          await db.query(
            `select count(*)::int n from bed_allocations where student_id=$1 and status='vacated'`,
            [sid],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "archive disables profile and releases allocation; restore does not reoccupy",
    async () => {
      await as("authenticated", admin, () =>
        rpc("status", { id: sid, status: "archived" }),
      );
      assert.equal(
        (
          await db.query("select is_active from profiles where id=$1", [
            student,
          ])
        ).rows[0].is_active,
        false,
      );
      await assert.rejects(
        db.query(
          "insert into bed_allocations(student_id,bed_id) values($1,$2)",
          [sid, bed],
        ),
        /Only active/,
      );
      await as("authenticated", student, async () =>
        assert.equal((await db.query("select * from students")).rows.length, 0),
      );
      await as("authenticated", admin, () =>
        rpc("status", { id: sid, status: "active" }),
      );
      assert.equal(
        (
          await db.query(
            `select * from bed_allocations where student_id=$1 and status='active'`,
            [sid],
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "registration lease, idempotency and service-only functions",
    async () => {
      const id = "00000000-0000-4000-8000-000000000005";
      await as(
        "authenticated",
        admin,
        async () =>
          await assert.rejects(
            db.query("select claim_registration($1,$2,$3)", [id, admin, null]),
            /permission denied/,
          ),
      );
      await as("service_role", null, async () => {
        const studentNumber = (
          await db.query("select reserve_registration_student_id($1) id", [id])
        ).rows[0].id;
        const input = {
          student_id: studentNumber,
          email: "registration-contract@test.invalid",
          bed_id: bed,
        };
        const j = (
          await db.query("select * from claim_registration($1,$2,$3)", [
            id,
            admin,
            input,
          ])
        ).rows[0];
        assert.ok(j.lease_token);
        await assert.rejects(
          db.query("select claim_registration($1,$2,$3)", [id, admin, input]),
          /in progress/,
        );
        await db.query(
          "update student_registrations set lease_until=null where id=$1",
          [id],
        );
        const retry = (
          await db.query("select * from claim_registration($1,$2,$3)", [
            id,
            admin,
            input,
          ])
        ).rows[0];
        assert.equal(retry.auth_user_id, j.auth_user_id);
        assert.notEqual(retry.lease_token, j.lease_token);
        await assert.rejects(
          db.query("select finish_registration($1,$2)", [id, j.lease_token]),
          /no rows/,
        );
      });
    },
  );
  await t.test(
    "dashboard uses real aggregate counts and room deletion is restricted",
    async () => {
      await as("authenticated", admin, async () => {
        const d = (await db.query("select phase2_dashboard() d")).rows[0].d;
        assert.equal(d.students, 2);
        assert.equal(d.rooms, 1);
        assert.equal(d.occupied, 1);
        assert.equal(d.available, 2);
      });
      await assert.rejects(
        db.query("delete from rooms where id=$1", [room]),
        /foreign key/,
      );
    },
  );
  await t.test(
    "registration reserves the ID before claim, persists admission fields, and finalizes idempotently",
    async () => {
      await as("service_role", null, async () => {
        const registrationIds = [
          "00000000-0000-4000-8000-000000000020",
          "00000000-0000-4000-8000-000000000021",
        ];
        const concurrent = await Promise.all(
          registrationIds.map((registrationId) =>
            db.query("select reserve_registration_student_id($1) id", [
              registrationId,
            ]),
          ),
        );
        const numbers = concurrent.map((result) => result.rows[0].id);
        assert.match(numbers[0], /^HH-\d{8}$/);
        assert.match(numbers[1], /^HH-\d{8}$/);
        assert.notEqual(numbers[0], numbers[1]);
        assert.equal(
          (
            await db.query("select reserve_registration_student_id($1) id", [
              registrationIds[0],
            ])
          ).rows[0].id,
          numbers[0],
        );
        await assert.rejects(
          db.query("select * from claim_registration($1,$2,$3)", [
            "00000000-0000-4000-8000-000000000022",
            admin,
            { email: "no-id@test.invalid", student_id: null },
          ]),
          /reserved student ID is required/,
        );
      });
      await assert.rejects(
        as("authenticated", admin, () =>
          db.query("select reserve_registration_student_id($1)", [
            "00000000-0000-4000-8000-000000000023",
          ]),
        ),
        /permission denied/,
      );
      const id = "00000000-0000-4000-8000-000000000009";
      const formPayload = {
        email: "new@test.invalid",
        bed_id: bed,
        full_name: "New student",
        date_of_birth: "2001-02-03",
        gender: "other",
        phone: "9999999999",
        course: "Course",
        branch: "Branch",
        academic_year: "2026",
        semester: 2,
        permanent_address: "Address",
        city: "City",
        state: "State",
        pincode: "123456",
        current_address: "Current address",
        admission_date: "2026-10-26",
        allocation_start_date: "2026-10-27",
        admission_note: "Admission note",
        guardian_name: "Guardian",
        relationship: "Parent",
        guardian_phone: "9999999999",
        guardian_email: "",
        emergency_contact: "9999999999",
        emergency_contact_name: "Emergency contact",
        guardian_address: "Guardian address",
      };
      let job, studentNumber;
      await as("service_role", null, async () => {
        const occupiedBed = (
          await db.query(
            "select bed_id from bed_allocations where status='active' limit 1",
          )
        ).rows[0].bed_id;
        const unavailableId = "00000000-0000-4000-8000-000000000012";
        const unavailableNumber = (
          await db.query("select reserve_registration_student_id($1) id", [
            unavailableId,
          ])
        ).rows[0].id;
        await assert.rejects(
          db.query("select * from claim_registration($1,$2,$3)", [
            unavailableId,
            admin,
            {
              ...formPayload,
              email: "unavailable-bed@test.invalid",
              student_id: unavailableNumber,
              bed_id: occupiedBed,
            },
          ]),
          /Selected bed is unavailable/,
        );
        studentNumber = (
          await db.query("select reserve_registration_student_id($1) id", [id])
        ).rows[0].id;
        assert.match(studentNumber, /^HH-\d{8}$/);
        const input = { ...formPayload, student_id: studentNumber };
        job = (
          await db.query("select * from claim_registration($1,$2,$3)", [
            id,
            admin,
            input,
          ])
        ).rows[0];
      });
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        job.auth_user_id,
        formPayload.email,
      ]);
      await as("service_role", null, async () => {
        const first = (
          await db.query("select finish_registration($1,$2) id", [
            id,
            job.lease_token,
          ])
        ).rows[0].id;
        const second = (
          await db.query("select finish_registration($1,$2) id", [
            id,
            job.lease_token,
          ])
        ).rows[0].id;
        assert.equal(first, second);
        const saved = (
          await db.query(
            "select student_id, current_address, admission_date, admission_note from students where id=$1",
            [first],
          )
        ).rows[0];
        assert.equal(saved.student_id, studentNumber);
        assert.equal(saved.current_address, "Current address");
        assert.equal(
          saved.admission_date.toISOString().slice(0, 10),
          "2026-10-26",
        );
        assert.equal(saved.admission_note, "Admission note");
        const persistedRegistration = (
          await db.query(
            "select student_number, payload->>'student_id' as payload_student_id from student_registrations where id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(persistedRegistration.student_number, studentNumber);
        assert.equal(persistedRegistration.payload_student_id, studentNumber);
        assert.equal(
          (
            await db.query("select * from guardians where student_id=$1", [
              first,
            ])
          ).rows.length,
          1,
        );
        const guardian = (
          await db.query(
            "select emergency_contact_name, address from guardians where student_id=$1",
            [first],
          )
        ).rows[0];
        assert.equal(guardian.emergency_contact_name, "Emergency contact");
        assert.equal(guardian.address, "Guardian address");
        assert.equal(
          (
            await db.query(
              "select * from bed_allocations where student_id=$1",
              [first],
            )
          ).rows.length,
          1,
        );
      });
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [job.auth_user_id],
      );
      assert.equal(
        (
          await db.query(
            "select invitation_status from student_registrations where id=$1",
            [id],
          )
        ).rows[0].invitation_status,
        "accepted",
      );
      await as("service_role", null, async () => {
        const duplicateEmailId = "00000000-0000-4000-8000-000000000010";
        const duplicateEmailNumber = (
          await db.query("select reserve_registration_student_id($1) id", [
            duplicateEmailId,
          ])
        ).rows[0].id;
        await assert.rejects(
          db.query("select * from claim_registration($1,$2,$3)", [
            duplicateEmailId,
            admin,
            {
              ...formPayload,
              email: "s@test.invalid",
              student_id: duplicateEmailNumber,
            },
          ]),
          /already registered/,
        );
        const duplicateNumberId = "00000000-0000-4000-8000-000000000011";
        await db.query("select reserve_registration_student_id($1)", [
          duplicateNumberId,
        ]);
        await assert.rejects(
          db.query("select * from claim_registration($1,$2,$3)", [
            duplicateNumberId,
            admin,
            {
              ...formPayload,
              email: "another@test.invalid",
              student_id: studentNumber,
            },
          ]),
          /not reserved for this registration/,
        );
      });
    },
  );
  await db.close();
});
