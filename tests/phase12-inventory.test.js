import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { makeCsv } from "../src/lib/csvExport.js";

test("Phase 12 inventory keeps asset and stock mutations staff-only and audited", async (t) => {
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
  for (const file of ["20261018093740_phase1_profiles.sql","20261018093812_phase2_student_management.sql","20261025120000_phase7_complaints.sql","20261025170000_phase12_inventory_management.sql"]) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  const admin = "00000000-0000-4000-8000-000000000001";
  const student = "00000000-0000-4000-8000-000000000002";
  await db.query("insert into auth.users(id,email) values($1,'admin@example.test'),($2,'student@example.test')", [admin,student]);
  await db.query("update profiles set role=case when id=$1 then 'admin' else 'student' end", [admin]);
  const as = async (id, fn) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    try { return await fn(); } finally { await db.exec("reset role"); }
  };
  await db.query(`insert into students(user_id,student_id,full_name,date_of_birth,gender,email,phone,course,branch,academic_year,semester,permanent_address,city,state,pincode)
    values($1,'HH-00000001','Student Example','2001-01-01','other','student@example.test','9999999999','Course','Branch','2026',1,'Address','City','State','123456')`,[student]);
  await db.query("insert into hostels(id,name,block,status) values('00000000-0000-4000-8000-000000000010','Hostel','A','active')");
  const room=(await db.query("insert into rooms(hostel_id,room_number,capacity,room_type) values('00000000-0000-4000-8000-000000000010','101',1,'Single') returning id")).rows[0].id;
  const complaint=(await as(student,async()=> (await db.query("select complaint_submit($1::jsonb,$2) result",[JSON.stringify({title:"Broken desk lamp",category:"electrical",description:"The desk lamp is not working and needs a repair.",location_detail:"Near the study desk"}),"10000000-0000-4000-8000-000000000001"])).rows[0].result)).id;
  const task=(await as(admin,async()=> (await db.query("select complaint_create_maintenance($1,$2,now()+interval '1 day',null,null) id",[complaint,admin])).rows[0].id));

  await as(student, async () => {
    await assert.rejects(db.query("select inventory_register_asset($1::jsonb)",[JSON.stringify({asset_code:"A-1",name:"Desk",category:"Furniture"})]),/Active administrator or warden access required/);
    await assert.rejects(db.query("select * from inventory_assets"),/permission denied/);
    await assert.rejects(db.query("select inventory_stock_adjust($1,'received',1,'Initial stock')",["00000000-0000-4000-8000-000000000099"]),/Active administrator or warden access required/);
  });

  const asset=(await as(admin,async()=> (await db.query("select inventory_register_asset($1::jsonb) id",[JSON.stringify({asset_code:"AST-001",name:"Study desk",category:"Furniture",quantity:2,hostel_id:"00000000-0000-4000-8000-000000000010",room_id:room})])).rows[0].id));
  await as(admin,async()=>{
    await assert.rejects(db.query("select inventory_register_asset($1::jsonb)",[JSON.stringify({asset_code:" ast-001 ",name:"Duplicate desk",category:"Furniture"})]),/inventory_assets_code_unique/);
    await db.query("select inventory_move_asset($1,null,null,'Central store','Room renovation')",[asset]);
    await db.query("select inventory_link_maintenance($1,$2,'Desk repair')",[asset,task]);
    await db.query("select inventory_link_maintenance($1,$2,'Desk repair retry')",[asset,task]);
  });
  const history=(await as(admin,async()=> (await db.query("select inventory_asset_history($1) value",[asset])).rows[0].value));
  assert.equal(history.events.filter(e=>e.event_type==="moved").length,1);
  assert.equal(history.events.filter(e=>e.event_type==="maintenance_linked").length,1);
  assert.equal(history.maintenance.length,1);

  const stockId=(await as(admin,async()=> (await db.query("select inventory_register_stock_item($1::jsonb) id",[JSON.stringify({item_code:"CLN-01",name:"Floor cleaner",category:"Cleaning",unit:"litre",minimum_quantity:3})])).rows[0].id));
  await as(admin,async()=>{
    await db.query("select inventory_stock_adjust($1,'received',5,'Opening stock')",[stockId]);
    await db.query("select inventory_stock_adjust($1,'issued',2,'Routine cleaning')",[stockId]);
    await assert.rejects(db.query("select inventory_stock_adjust($1,'issued',4,'Over issue attempt')",[stockId]),/Cannot issue more stock than is available/);
    await assert.rejects(db.query("select inventory_stock_adjust($1,'issued',-1,'Invalid amount')",[stockId]),/Valid stock action/);
  });
  assert.equal((await db.query("select quantity_on_hand from inventory_stock_items where id=$1",[stockId])).rows[0].quantity_on_hand,"3.000");
  assert.equal((await db.query("select count(*)::int n from inventory_stock_transactions where item_id=$1",[stockId])).rows[0].n,2);
  const metrics=(await as(admin,async()=> (await db.query("select inventory_dashboard_metrics() value")).rows[0].value));
  assert.equal(metrics.low_stock_items,1);
  assert.equal(metrics.total_asset_records,1);
});

test("inventory CSV export escapes cells and neutralizes spreadsheet formulas", () => {
  const csv=makeCsv([{asset_code:'=HYPERLINK("https://bad")',name:'Desk, "oak"\nsecond line'}],[{key:"asset_code",label:"Code"},{key:"name",label:"Name"}]);
  assert.match(csv, /'=HYPERLINK\(""https:\/\/bad""\)/);
  assert.match(csv, /"Desk, ""oak""\nsecond line"/);
});
