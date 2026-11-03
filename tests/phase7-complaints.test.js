import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  complaintSchema,
  validateComplaintFiles,
} from "../src/lib/complaintValidation.js";

test("Phase 7 complaint privacy, staff workflow, attachments and maintenance", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security; grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated; create publication supabase_realtime;`);
  for (const file of [
    "20261018093740_phase1_profiles.sql",
    "20261018093812_phase2_student_management.sql",
    "20261025120000_phase7_complaints.sql",
    "20261025130000_phase8_mess_management.sql",
    "20261102163436_weekly_mess_routine.sql",
    "20261025140000_phase9_operations_reporting.sql",
  ]) {
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const admin = "00000000-0000-4000-8000-000000000001";
  const studentA = "00000000-0000-4000-8000-000000000002";
  const studentB = "00000000-0000-4000-8000-000000000003";
  const warden = "00000000-0000-4000-8000-000000000004";
  await db.query(
    "insert into auth.users(id,email) values($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test'),($4,'d@example.test')",
    [admin, studentA, studentB, warden],
  );
  await db.query(
    "update profiles set role=case when id=$1 then 'admin' when id=$2 then 'warden' else 'student' end",
    [admin, warden],
  );
  const as = async (id, fn) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };
  const studentIds = [];
  for (const [index, userId] of [studentA, studentB].entries()) {
    studentIds.push(
      (
        await db.query(
          `insert into students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode)
           values($1,$2,$3,'2001-01-01','other',$4,'9999999999','Course','Branch','2026',1,'Address','City','State','123456') returning id`,
          [
            userId,
            `HH-0000000${index + 1}`,
            `Student ${index + 1}`,
            `${index + 1}@example.test`,
          ],
        )
      ).rows[0].id,
    );
  }
  await db.query(
    "insert into hostels(id,name,block) values('00000000-0000-4000-8000-000000000010','Hostel','A')",
  );
  const room = (
    await db.query(
      "insert into rooms(hostel_id,room_number,capacity,room_type) values('00000000-0000-4000-8000-000000000010','101',1,'Single') returning id",
    )
  ).rows[0].id;
  const bed = (
    await db.query(
      "insert into beds(room_id,bed_number) values($1,'1') returning id",
      [room],
    )
  ).rows[0].id;
  await db.query(
    "insert into bed_allocations(student_id,bed_id) values($1,$2)",
    [studentIds[0], bed],
  );
  assert.equal(
    (await db.query("select count(*)::int n from mess_weekly_routine")).rows[0].n,
    21,
  );
  assert.equal(
    (await db.query("select count(*)::int n from mess_meal_times")).rows[0].n,
    3,
  );
  assert.deepEqual(
    (await db.query("select meal_slot,serving_start::text,serving_end::text from mess_meal_times order by meal_slot")).rows,
    [
      { meal_slot: "breakfast", serving_start: "07:00:00", serving_end: "08:00:00" },
      { meal_slot: "dinner", serving_start: "19:30:00", serving_end: "21:00:00" },
      { meal_slot: "lunch", serving_start: "12:30:00", serving_end: "14:00:00" },
    ],
  );
  const weeklyRoutine = Array.from({ length: 7 }, (_, weekday) =>
    ["breakfast", "lunch", "dinner"].map((meal_slot) => ({
      weekday,
      meal_slot,
      menu_text: weekday === 1 && meal_slot === "breakfast" ? "Poha and tea" : "",
    })),
  ).flat();
  const weeklyTimes = [
    { meal_slot: "breakfast", serving_start: "07:15", serving_end: "08:15" },
    { meal_slot: "lunch", serving_start: "12:30", serving_end: "14:00" },
    { meal_slot: "dinner", serving_start: "19:30", serving_end: "21:00" },
  ];
  await as(admin, () => db.query("select mess_save_weekly_routine($1::jsonb,$2::jsonb)", [JSON.stringify(weeklyRoutine), JSON.stringify(weeklyTimes)]));
  await as(studentA, async () => {
    assert.equal((await db.query("select count(*)::int n from mess_weekly_routine")).rows[0].n, 21);
    assert.equal((await db.query("select menu_text from mess_weekly_routine where weekday=1 and meal_slot='breakfast'")).rows[0].menu_text, "Poha and tea");
    await assert.rejects(
      db.query("update mess_weekly_routine set menu_text='unauthorized' where weekday=1 and meal_slot='breakfast'"),
      /permission denied/i,
    );
    await assert.rejects(
      db.query("select mess_save_weekly_routine($1::jsonb,$2::jsonb)", [JSON.stringify(weeklyRoutine), JSON.stringify(weeklyTimes)]),
      /Active administrator access required/,
    );
  });
  const nonce = "10000000-0000-4000-8000-000000000001";
  const payload = {
    title: "Leaking bathroom pipe",
    category: "plumbing",
    description: "Water is leaking below the sink and needs repair.",
    location_detail: "Bathroom near the sink",
    student_id: studentIds[1],
    room_label: "FAKE ROOM",
  };
  const created = await as(
    studentA,
    async () =>
      (
        await db.query("select complaint_submit($1::jsonb,$2) result", [
          JSON.stringify(payload),
          nonce,
        ])
      ).rows[0].result,
  );
  const repeated = await as(
    studentA,
    async () =>
      (
        await db.query("select complaint_submit($1::jsonb,$2) result", [
          JSON.stringify(payload),
          nonce,
        ])
      ).rows[0].result,
  );
  assert.equal(created.id, repeated.id);
  assert.match(created.complaint_number, /^CMP-\d{8}$/);
  assert.equal(
    (await db.query("select count(*)::int n from complaints")).rows[0].n,
    1,
  );
  const record = (
    await db.query(
      "select student_id,room_label,priority,status from complaints where id=$1",
      [created.id],
    )
  ).rows[0];
  assert.equal(record.student_id, studentIds[0]);
  assert.equal(record.room_label, "Hostel / A · room 101 · bed 1");
  assert.equal(record.priority, "normal");
  assert.equal(record.status, "submitted");

  await as(studentA, async () => {
    assert.equal(
      (await db.query("select count(*)::int n from complaints")).rows[0].n,
      1,
    );
    await assert.rejects(
      db.query("select complaint_add_message($1,'secret','internal')", [
        created.id,
      ]),
      /Students can only send/,
    );
    await assert.rejects(
      db.query("select complaint_assign($1,$2)", [created.id, admin]),
      /Authorized staff access required/,
    );
    await assert.rejects(
      db.query("select complaint_transition($1,'resolved','Done')", [
        created.id,
      ]),
      /Authorized staff access required/,
    );
  });
  await as(studentB, async () => {
    assert.equal(
      (await db.query("select count(*)::int n from complaints")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select complaint_add_message($1,'Intrusion','student')", [
        created.id,
      ]),
      /Complaint not found/,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('complaint-attachments',$1)",
        [`${created.id}/20000000-0000-4000-8000-000000000001.png`],
      ),
      /new row violates row-level security/,
    );
  });
  await as(studentA, async () => {
    await assert.rejects(
      db.query(
        "select complaint_transition($1,'closed','Attempted direct update')",
        [created.id],
      ),
      /Authorized staff access required/,
    );
  });

  await as(studentA, async () => {
    await db.query(
      "insert into storage.objects(bucket_id,name) values('complaint-attachments',$1)",
      [`${created.id}/20000000-0000-4000-8000-000000000001.png`],
    );
    await db.query("select complaint_register_attachments($1,null,$2::jsonb)", [
      created.id,
      JSON.stringify([
        {
          path: `${created.id}/20000000-0000-4000-8000-000000000001.png`,
          name: "sink.png",
          type: "image/png",
          size: 100,
        },
      ]),
    ]);
    await db.query("delete from storage.objects where name=$1", [
      `${created.id}/20000000-0000-4000-8000-000000000001.png`,
    ]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from storage.objects where name=$1",
          [`${created.id}/20000000-0000-4000-8000-000000000001.png`],
        )
      ).rows[0].n,
      1,
    );
  });
  await as(studentB, async () => {
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from complaint_attachments"))
        .rows[0].n,
      0,
    );
  });
  await as(warden, async () => {
    await db.query("select complaint_assign($1,$2)", [created.id, warden]);
    await db.query(
      "select complaint_add_message($1,'Technician has been asked to inspect.','internal')",
      [created.id],
    );
    await db.query(
      "select complaint_add_message($1,'We have received your report and will inspect the pipe.','student')",
      [created.id],
    );
    await assert.rejects(
      db.query("select complaint_assign($1,$2)", [created.id, studentB]),
      /Assignee must be an active administrator or warden/,
    );
    await db.query("select complaint_assign($1,null)", [created.id]);
    await db.query("select complaint_assign($1,$2)", [created.id, warden]);
    await assert.rejects(
      db.query("select complaint_transition($1,'resolved','')", [created.id]),
      /Invalid complaint status transition/,
    );
    await assert.rejects(
      db.query(
        "select complaint_transition($1,'closed','Resolved without progress')",
        [created.id],
      ),
      /Invalid complaint status transition/,
    );
    await db.query(
      "select complaint_transition($1,'acknowledged',null,'high')",
      [created.id],
    );
    await assert.rejects(
      db.query("select complaint_transition($1,'resolved','')", [created.id]),
      /Resolution details are required/,
    );
    await db.query("select complaint_transition($1,'in_progress')", [
      created.id,
    ]);
    await db.query(
      "select complaint_transition($1,'resolved','Pipe repaired and water leak stopped.')",
      [created.id],
    );
    await db.query("select complaint_transition($1,'closed')", [created.id]);
  });
  await as(studentA, async () => {
    const visible = await db.query(
      "select visibility,message from complaint_messages where complaint_id=$1",
      [created.id],
    );
    assert.deepEqual(visible.rows, [
      {
        visibility: "student",
        message: "We have received your report and will inspect the pipe.",
      },
    ]);
    const events = await db.query(
      "select event_type,old_value,new_value from complaint_events where complaint_id=$1",
      [created.id],
    );
    assert.equal(
      events.rows.some((event) => event.event_type === "priority_changed"),
      false,
    );
    assert.equal(
      events.rows.some(
        (event) =>
          event.event_type === "assigned" &&
          /[0-9a-f-]{36}/i.test(`${event.old_value} ${event.new_value}`),
      ),
      false,
    );
    await assert.rejects(
      db.query("select assigned_staff_id from complaints where id=$1", [
        created.id,
      ]),
      /permission denied/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from complaint_notifications where complaint_id=$1",
          [created.id],
        )
      ).rows[0].n >= 2,
      true,
    );
  });

  const details = await as(
    warden,
    async () =>
      (await db.query("select complaint_staff_detail($1) value", [created.id]))
        .rows[0].value,
  );
  assert.equal(
    details.messages.some((message) => message.visibility === "internal"),
    true,
  );
  assert.equal(details.room_label, record.room_label);
  const initialTask = await as(
    warden,
    async () =>
      (
        await db.query(
          "select complaint_create_maintenance($1,$2,now()+interval '1 day',25,'USD') id",
          [created.id, warden],
        )
      ).rows[0].id,
  );
  const retriedTask = await as(
    warden,
    async () =>
      (
        await db.query(
          "select complaint_create_maintenance($1,$2,now()+interval '2 days',99,'USD') id",
          [created.id, warden],
        )
      ).rows[0].id,
  );
  assert.equal(initialTask, retriedTask);
  await as(warden, async () => {
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from storage.objects where name like $1",
          [`${created.id}/%`],
        )
      ).rows[0].n,
      1,
    );
  });
  await as(warden, async () => {
    await db.query(
      "select complaint_update_maintenance($1,'scheduled',$2,now(),'Visit scheduled',null,null)",
      [initialTask, warden],
    );
    await db.query(
      "select complaint_update_maintenance($1,'in_progress',$2,now(),'Work started',null,null)",
      [initialTask, warden],
    );
    await db.query(
      "select complaint_update_maintenance($1,'completed',$2,now(),'Replaced pipe',30,'USD')",
      [initialTask, warden],
    );
  });
  await as(warden, async () =>
    assert.rejects(
      db.query(
        "select complaint_update_maintenance($1,'open',$2,now(),'Reopen',null,null)",
        [initialTask, warden],
      ),
      /Invalid maintenance status transition/,
    ),
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from complaint_maintenance_tasks where complaint_id=$1",
        [created.id],
      )
    ).rows[0].n,
    1,
  );
  assert.ok(
    (
      await db.query(
        "select count(*)::int n from complaint_events where complaint_id=$1",
        [created.id],
      )
    ).rows[0].n >= 5,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from complaint_notifications where complaint_id=$1",
        [created.id],
      )
    ).rows[0].n >= 2,
    true,
  );
  // Phase 8 shares the authenticated users and complaint workflow above.
  const menuDate = new Date().toISOString().slice(0, 10);
  const menuId = await as(
    admin,
    async () =>
      (
        await db.query(`select mess_save_menu($1::jsonb) id`, [
          JSON.stringify({
            meal_date: menuDate,
            meal_slot: "breakfast",
            title: "Test breakfast",
            description: "",
            serving_start: "07:00",
            serving_end: "08:00",
            items: [
              { name: "Porridge", description: "Oats", allergens: ["oats"] },
            ],
          }),
        ])
      ).rows[0].id,
  );
  await as(studentA, async () => {
    await assert.rejects(
      db.query("select mess_save_menu('{}'::jsonb)"),
      /Active administrator access required/,
    );
    await assert.rejects(
      db.query("select mess_admin_summary(current_date,current_date)"),
      /Active administrator access required/,
    );
    assert.equal(
      (
        await db.query("select count(*)::int n from mess_menus where id=$1", [
          menuId,
        ])
      ).rows[0].n,
      0,
    );
  });
  await as(admin, async () => {
    await db.query("select mess_set_menu_status($1,'published')", [menuId]);
  });
  await as(studentA, async () => {
    assert.equal(
      (
        await db.query("select count(*)::int n from mess_menus where id=$1", [
          menuId,
        ])
      ).rows[0].n,
      1,
    );
    const payload = {
      meal_date: menuDate,
      meal_slot: "breakfast",
      rating: 4,
      category: "taste",
      comments: "Good",
    };
    await db.query("select mess_submit_feedback($1::jsonb)", [
      JSON.stringify(payload),
    ]);
    await assert.rejects(
      db.query("select mess_submit_feedback($1::jsonb)", [
        JSON.stringify(payload),
      ]),
      /edit window has closed/,
    );
    await assert.rejects(
      db.query(
        "insert into mess_feedback(student_id,menu_id,meal_date,meal_slot,rating) values($1,$2,$3,'breakfast',8)",
        [studentIds[0], menuId, menuDate],
      ),
      /permission denied/,
    );
  });
  await as(admin, async () => db.query("select mess_set_feedback_policy(24)"));
  await as(studentA, async () =>
    db.query("select mess_submit_feedback($1::jsonb)", [
      JSON.stringify({
        meal_date: menuDate,
        meal_slot: "breakfast",
        rating: 5,
        comments: "Updated",
      }),
    ]),
  );
  await as(studentB, async () => {
    assert.equal(
      (await db.query("select count(*)::int n from mess_feedback")).rows[0].n,
      0,
    );
    await db.query("select mess_submit_feedback($1::jsonb)", [
      JSON.stringify({
        meal_date: menuDate,
        meal_slot: "breakfast",
        rating: 2,
        comments: "Needs work",
      }),
    ]);
    await assert.rejects(
      db.query("select mess_submit_feedback($1::jsonb)", [
        JSON.stringify({
          meal_date: menuDate,
          meal_slot: "breakfast",
          rating: 0,
        }),
      ]),
      /Rating must be between 1 and 5/,
    );
  });
  await assert.rejects(
    db.query(
      "insert into mess_feedback(student_id,menu_id,meal_date,meal_slot,rating) values($1,$2,$3,'breakfast',3)",
      [studentIds[0], menuId, menuDate],
    ),
    /duplicate key value violates unique constraint/,
  );
  const messReport = await as(
    studentA,
    async () =>
      (
        await db.query("select complaint_submit($1::jsonb,$2::uuid) value", [
          JSON.stringify({
            title: "Food quality concern",
            category: "mess_food_quality",
            description: "The meal was served cold and needs attention.",
            location_detail: "Dining hall",
          }),
          "30000000-0000-4000-8000-000000000001",
        ])
      ).rows[0].value,
  );
  assert.equal(
    (
      await db.query("select category from complaints where id=$1", [
        messReport.id,
      ])
    ).rows[0].category,
    "mess_food_quality",
  );
  await as(studentB, async () =>
    assert.equal(
      (
        await db.query("select count(*)::int n from complaints where id=$1", [
          messReport.id,
        ])
      ).rows[0].n,
      0,
    ),
  );
  await as(studentA, async () =>
    assert.equal(
      (await db.query("select count(*)::int n from mess_notifications")).rows[0]
        .n,
      1,
    ),
  );
  await as(studentB, async () =>
    assert.equal(
      (await db.query("select count(*)::int n from mess_notifications")).rows[0]
        .n,
      1,
    ),
  );
  await as(studentB, async () =>
    assert.rejects(
      db.query("select admin_operations_metrics()"),
      /Active administrator access required/,
    ),
  );
  await as(admin, async () => {
    const stats = (
      await db.query("select mess_admin_summary($1,$2) value", [
        menuDate,
        menuDate,
      ])
    ).rows[0].value;
    assert.equal(stats.feedback.count, 2);
    assert.equal(stats.complaints.total, 1);
    const operations = (
      await db.query("select admin_operations_metrics(null,null) value")
    ).rows[0].value;
    assert.equal(operations.complaints.open, 1);
    assert.equal(operations.maintenance.open, 0);
    assert.ok(operations.complaints.average_first_staff_reply_minutes >= 0);
    await assert.rejects(
      db.query(
        "select admin_operations_metrics(current_date,current_date+368)",
      ),
      /Provide both valid dates/,
    );
  });
});

test("complaint form and attachment validation", () => {
  assert.equal(
    complaintSchema.safeParse({
      title: "Broken lamp",
      category: "electrical",
      description: "The lamp beside my bed is not working.",
      location_detail: "Near bed",
    }).success,
    true,
  );
  assert.equal(
    complaintSchema.safeParse({
      title: "x",
      category: "electrical",
      description: "short",
    }).success,
    false,
  );
  assert.throws(
    () => validateComplaintFiles([{ type: "application/pdf", size: 20 }]),
    /JPEG, PNG, or WebP/,
  );
  assert.throws(
    () =>
      validateComplaintFiles([{ type: "image/png", size: 6 * 1024 * 1024 }]),
    /5 MB/,
  );
  assert.throws(
    () =>
      validateComplaintFiles(
        Array.from({ length: 4 }, () => ({ type: "image/png", size: 10 })),
      ),
    /up to 3/,
  );
  assert.doesNotThrow(() =>
    validateComplaintFiles([{ type: "image/webp", size: 20 }]),
  );
});
