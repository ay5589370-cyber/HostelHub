import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Phase 6 fee ledger authorization, balances, idempotency and audit", async (t) => {
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
    "20261025110000_phase6_fee_management.sql",
  ]) {
    await db.exec(
      readFileSync(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const admin = "00000000-0000-4000-8000-000000000001";
  const student = "00000000-0000-4000-8000-000000000002";
  const other = "00000000-0000-4000-8000-000000000003";
  const reviewer = "00000000-0000-4000-8000-000000000004";
  await db.query(
    "insert into auth.users(id,email) values($1,'admin@example.test'),($2,'student@example.test'),($3,'other@example.test'),($4,'reviewer@example.test')",
    [admin, student, other, reviewer],
  );
  await db.query("update profiles set role='admin' where id in ($1,$2)", [
    admin,
    reviewer,
  ]);
  const as = async (id, fn) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };
  const studentId = (
    await db.query(
      `insert into students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode)
    values($1,'HH-00000001','Fee Student','2001-01-01','other','student@example.test','9999999999','Course','Branch','2026',1,'Address','City','State','123456') returning id`,
      [student],
    )
  ).rows[0].id;
  const otherId = (
    await db.query(
      `insert into students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode)
    values($1,'HH-00000002','Other Student','2001-01-01','other','other@example.test','9999999998','Course','Branch','2026',1,'Address','City','State','123456') returning id`,
      [other],
    )
  ).rows[0].id;
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
  const allocation = (
    await db.query(
      "insert into bed_allocations(student_id,bed_id) values($1,$2) returning id",
      [studentId, bed],
    )
  ).rows[0].id;
  await db.query(
    "insert into student_registrations(id,student_id,auth_user_id,requested_by,payload,email,student_number) values('00000000-0000-4000-8000-000000000020',$1,$2,$3,'{}','student@example.test','HH-00000001')",
    [studentId, student, admin],
  );
  {
    await as(admin, async () => {
      await assert.rejects(
        db.query("select fee_save_plan($1::jsonb)", [
          JSON.stringify({
            name: "Invalid precision",
            room_type: "Double",
            amount: 1.001,
            currency_code: "USD",
            currency_minor_units: 2,
            billing_period: "term",
            academic_term: "2026-T1",
            due_date: "2026-12-01",
          }),
        ]),
        /currency precision/,
      );
    });
    const planId = await as(
      admin,
      async () =>
        (
          await db.query(`select fee_save_plan($1::jsonb) id`, [
            JSON.stringify({
              name: "Single room",
              room_type: "Single",
              amount: 100,
              currency_code: "USD",
              currency_minor_units: 2,
              billing_period: "term",
              academic_term: "2026-T1",
              due_date: "2026-12-01",
            }),
          ])
        ).rows[0].id,
    );
    const count = await as(
      admin,
      async () =>
        (await db.query("select fee_generate_invoices($1) n", [planId])).rows[0]
          .n,
    );
    assert.equal(count, 1);
    const repeated = await as(
      admin,
      async () =>
        (await db.query("select fee_generate_invoices($1) n", [planId])).rows[0]
          .n,
    );
    assert.equal(repeated, 0);
    const inv = (
      await db.query("select id from fee_invoices where student_id=$1", [
        studentId,
      ])
    ).rows[0].id;
    await as(other, async () => {
      assert.equal(
        (await db.query("select count(*)::int n from fee_invoice_balances"))
          .rows[0].n,
        0,
      );
      await assert.rejects(
        db.query("select fee_generate_invoices($1)", [planId]),
        /Administrator access required/,
      );
      await assert.rejects(
        db.query(
          "select fee_record_payment($1,1,'cash','unauthorized','2026-01-01','')",
          [inv],
        ),
        /Administrator access required/,
      );
    });
    assert.ok(allocation);
    const own = await as(
      student,
      async () =>
        (await db.query("select student_id from fee_invoice_balances")).rows,
    );
    assert.deepEqual(
      own.map((x) => x.student_id),
      [studentId],
    );
    const noOther = await as(
      other,
      async () =>
        (await db.query("select count(*)::int n from fee_invoice_balances"))
          .rows[0].n,
    );
    assert.equal(noOther, 0);

    const auditBeforeWaiver = (
      await db.query("select count(*)::int n from fee_audit_log")
    ).rows[0].n;
    await as(admin, async () => {
      await db.query(
        "select fee_add_adjustment($1,10,'Approved hardship waiver')",
        [inv],
      );
      await assert.rejects(
        db.query(
          "select fee_add_adjustment($1,101,'Excessive waiver reason')",
          [inv],
        ),
        /Adjustment exceeds/,
      );
      await assert.rejects(
        db.query("select fee_add_adjustment($1,1,'no')", [inv]),
        /positive amount and a reason/,
      );
    });
    assert.equal(
      (await db.query("select count(*)::int n from fee_audit_log")).rows[0].n,
      auditBeforeWaiver + 1,
    );

    let payId;
    await as(admin, async () => {
      await assert.rejects(
        db.query(
          "select fee_record_payment($1,-1,'cash','REF-1','2026-01-01','')",
          [inv],
        ),
        /Valid positive amount/,
      );
      await assert.rejects(
        db.query(
          "select fee_record_payment($1,1.001,'cash','REF-FRACTION','2026-01-01','')",
          [inv],
        ),
        /currency precision/,
      );
      payId = (
        await db.query(
          "select fee_record_payment($1,40,'cash','REF-1','2026-01-01','receipt') id",
          [inv],
        )
      ).rows[0].id;
      await assert.rejects(
        db.query(
          "select fee_record_payment($1,10,'cash','REF-1','2026-01-01','duplicate')",
          [inv],
        ),
        /duplicate key/,
      );
    });
    await as(reviewer, async () =>
      db.query("select fee_review_payment($1,'verified','checked')", [payId]),
    );
    let balance = (
      await db.query(
        "select amount_paid,balance,payment_status from fee_invoice_balances where id=$1",
        [inv],
      )
    ).rows[0];
    assert.equal(Number(balance.amount_paid), 40);
    assert.equal(Number(balance.balance), 50);
    assert.equal(balance.payment_status, "partially_paid");
    let next;
    let extra;
    await as(admin, async () => {
      next = (
        await db.query(
          "select fee_record_payment($1,50,'cash','REF-2','2026-01-02','') id",
          [inv],
        )
      ).rows[0].id;
      extra = (
        await db.query(
          "select fee_record_payment($1,10,'cash','REF-3','2026-01-03','') id",
          [inv],
        )
      ).rows[0].id;
    });
    await as(reviewer, async () =>
      db.query("select fee_review_payment($1,'verified','checked')", [next]),
    );
    await as(reviewer, async () =>
      assert.rejects(
        db.query("select fee_review_payment($1,'verified','checked')", [extra]),
        /exceeds the remaining verified balance/,
      ),
    );
    balance = (
      await db.query(
        "select amount_paid,balance,payment_status from fee_invoice_balances where id=$1",
        [inv],
      )
    ).rows[0];
    assert.equal(Number(balance.amount_paid), 90);
    assert.equal(Number(balance.balance), 0);
    assert.equal(balance.payment_status, "paid");
  }
  assert.equal(otherId.length, 36);
});
