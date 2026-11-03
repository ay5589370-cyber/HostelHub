-- Phase 6 fee ledger. Depends only on Phase 1/2 tables and admin helper.
begin;

create table public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 100),
  room_type text not null check (length(trim(room_type)) between 1 and 100),
  amount numeric(14,3) not null check (amount > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  currency_minor_units smallint not null check (currency_minor_units between 0 and 3),
  billing_period text not null check (billing_period in ('monthly','term','annual','one_time')),
  academic_term text not null check (length(trim(academic_term)) between 1 and 100),
  due_date date not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_type, academic_term, billing_period)
);

create table public.fee_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  registration_id uuid references public.student_registrations(id),
  allocation_id uuid references public.bed_allocations(id),
  fee_plan_id uuid references public.fee_plans(id),
  student_number text not null,
  student_name text not null,
  room_label text not null,
  plan_name text not null,
  academic_term text not null,
  billing_period text not null check (billing_period in ('monthly','term','annual','one_time')),
  due_date date not null,
  base_amount numeric(14,3) not null check (base_amount >= 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  currency_minor_units smallint not null check (currency_minor_units between 0 and 3),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(student_id, academic_term, billing_period)
);
create index fee_invoices_student_due_idx on public.fee_invoices(student_id, due_date desc);
create index fee_invoices_term_idx on public.fee_invoices(academic_term, due_date);

create table public.fee_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.fee_invoices(id),
  amount numeric(14,3) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 5 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index fee_adjustments_invoice_idx on public.fee_adjustments(invoice_id);

create table public.fee_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.fee_invoices(id),
  amount numeric(14,3) not null check (amount > 0),
  payment_method text not null check (length(trim(payment_method)) between 2 and 60),
  reference_number text not null check (length(trim(reference_number)) between 2 and 120),
  paid_on date not null,
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'pending_verification' check (status in ('pending_verification','verified','rejected','reversed')),
  recorded_by uuid not null references public.profiles(id),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status='verified' and verified_by is not null and verified_at is not null) or status<>'verified')
);
create unique index fee_payment_reference_unique on public.fee_payments(lower(payment_method), lower(reference_number)) where status <> 'rejected';
create index fee_payments_invoice_idx on public.fee_payments(invoice_id, created_at desc);

create table public.fee_audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('plan','invoice','adjustment','payment')),
  entity_id uuid not null,
  action text not null,
  actor_id uuid not null references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index fee_audit_entity_idx on public.fee_audit_log(entity_type, entity_id, created_at desc);

alter table public.fee_plans enable row level security;
alter table public.fee_invoices enable row level security;
alter table public.fee_adjustments enable row level security;
alter table public.fee_payments enable row level security;
alter table public.fee_audit_log enable row level security;
revoke all on public.fee_plans, public.fee_invoices, public.fee_adjustments, public.fee_payments, public.fee_audit_log from anon, authenticated;
grant select on public.fee_plans, public.fee_invoices, public.fee_adjustments, public.fee_payments to authenticated;
grant select on public.fee_audit_log to authenticated;
grant all on public.fee_plans, public.fee_invoices, public.fee_adjustments, public.fee_payments, public.fee_audit_log to service_role;

create policy fee_plans_admin_read on public.fee_plans for select to authenticated using ((select private.is_active_admin()));
create policy fee_invoices_read on public.fee_invoices for select to authenticated using (
  (select private.is_active_admin()) or exists(select 1 from public.students s where s.id=fee_invoices.student_id and s.user_id=(select auth.uid()) and s.status='active' and exists(select 1 from public.profiles p where p.id=s.user_id and p.role='student' and p.is_active))
);
create policy fee_adjustments_read on public.fee_adjustments for select to authenticated using (
  (select private.is_active_admin()) or exists(select 1 from public.fee_invoices i join public.students s on s.id=i.student_id join public.profiles p on p.id=s.user_id where i.id=fee_adjustments.invoice_id and s.user_id=(select auth.uid()) and s.status='active' and p.role='student' and p.is_active)
);
create policy fee_payments_read on public.fee_payments for select to authenticated using (
  (select private.is_active_admin()) or exists(select 1 from public.fee_invoices i join public.students s on s.id=i.student_id join public.profiles p on p.id=s.user_id where i.id=fee_payments.invoice_id and s.user_id=(select auth.uid()) and s.status='active' and p.role='student' and p.is_active)
);
create policy fee_audit_admin_read on public.fee_audit_log for select to authenticated using ((select private.is_active_admin()));

create view public.fee_invoice_balances with (security_invoker=true) as
select i.*,
  greatest(0, i.base_amount - coalesce(a.adjusted,0)) as amount_due,
  coalesce(p.verified,0) as amount_paid,
  greatest(0, i.base_amount - coalesce(a.adjusted,0) - coalesce(p.verified,0)) as balance,
  case when i.base_amount - coalesce(a.adjusted,0) <= coalesce(p.verified,0) then 'paid'
       when i.due_date < current_date then 'overdue'
       when coalesce(p.verified,0)>0 then 'partially_paid' else 'pending' end as payment_status
from public.fee_invoices i
left join lateral (select sum(amount) adjusted from public.fee_adjustments where invoice_id=i.id) a on true
left join lateral (select sum(amount) verified from public.fee_payments where invoice_id=i.id and status='verified') p on true;
grant select on public.fee_invoice_balances to authenticated;

create function private.fee_require_admin() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_active_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return auth.uid();
end; $$;
revoke all on function private.fee_require_admin() from public,anon,authenticated;
grant execute on function private.fee_require_admin() to authenticated;

create function public.fee_save_plan(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result_id uuid;
begin
  actor := private.fee_require_admin();
  if coalesce((p_data->>'amount')::numeric,0) <= 0 then raise exception 'Fee must be greater than zero'; end if;
  if (p_data->>'amount')::numeric <> round((p_data->>'amount')::numeric,(p_data->>'currency_minor_units')::integer) then raise exception 'Fee amount exceeds the selected currency precision'; end if;
  insert into public.fee_plans(id,name,room_type,amount,currency_code,currency_minor_units,billing_period,academic_term,due_date,created_by)
  values(coalesce((p_data->>'id')::uuid,gen_random_uuid()),trim(p_data->>'name'),trim(p_data->>'room_type'),(p_data->>'amount')::numeric,upper(p_data->>'currency_code'),(p_data->>'currency_minor_units')::smallint,p_data->>'billing_period',trim(p_data->>'academic_term'),(p_data->>'due_date')::date,actor)
  on conflict (room_type,academic_term,billing_period) do update set name=excluded.name,amount=excluded.amount,currency_code=excluded.currency_code,currency_minor_units=excluded.currency_minor_units,due_date=excluded.due_date,active=true,updated_at=now()
  returning id into result_id;
  insert into public.fee_audit_log(entity_type,entity_id,action,actor_id,details) values('plan',result_id,'saved',actor,p_data - 'id');
  return result_id;
end; $$;
revoke all on function public.fee_save_plan(jsonb) from public,anon,authenticated;
grant execute on function public.fee_save_plan(jsonb) to authenticated;

create function public.fee_generate_invoices(p_plan_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid; plan public.fee_plans; row record; n integer:=0; inv uuid;
begin
  actor:=private.fee_require_admin();
  select * into strict plan from public.fee_plans where id=p_plan_id and active for share;
  for row in
    select s.id student_id,s.student_id student_number,s.full_name,sr.id registration_id,a.id allocation_id,
      h.name||' / '||h.block||' · '||r.room_number||' · bed '||b.bed_number room_label
    from public.students s join public.profiles pr on pr.id=s.user_id and pr.is_active and pr.role='student'
    join public.bed_allocations a on a.student_id=s.id and a.status='active'
    join public.beds b on b.id=a.bed_id join public.rooms r on r.id=b.room_id join public.hostels h on h.id=r.hostel_id
    left join public.student_registrations sr on sr.student_id=s.id
    where s.status='active' and r.room_type=plan.room_type and h.status='active' and r.status='available'
  loop
    inv:=gen_random_uuid();
    insert into public.fee_invoices(id,student_id,registration_id,allocation_id,fee_plan_id,student_number,student_name,room_label,plan_name,academic_term,billing_period,due_date,base_amount,currency_code,currency_minor_units,created_by)
    values(inv,row.student_id,row.registration_id,row.allocation_id,plan.id,row.student_number,row.full_name,row.room_label,plan.name,plan.academic_term,plan.billing_period,plan.due_date,plan.amount,plan.currency_code,plan.currency_minor_units,actor)
    on conflict(student_id,academic_term,billing_period) do nothing;
    if found then n:=n+1; insert into public.fee_audit_log(entity_type,entity_id,action,actor_id,details) values('invoice',inv,'generated',actor,jsonb_build_object('plan_id',plan.id,'amount',plan.amount)); end if;
  end loop;
  return n;
end; $$;
revoke all on function public.fee_generate_invoices(uuid) from public,anon,authenticated;
grant execute on function public.fee_generate_invoices(uuid) to authenticated;

create function public.fee_add_adjustment(p_invoice_id uuid,p_amount numeric,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result_id uuid; due numeric; paid numeric; digits smallint;
begin
  actor:=private.fee_require_admin();
  if p_amount is null or p_amount<=0 or length(trim(p_reason))<5 then raise exception 'A positive amount and a reason are required'; end if;
  select i.base_amount-coalesce((select sum(amount) from public.fee_adjustments where invoice_id=i.id),0),coalesce((select sum(amount) from public.fee_payments where invoice_id=i.id and status='verified'),0),i.currency_minor_units into strict due,paid,digits from public.fee_invoices i where i.id=p_invoice_id for update;
  if p_amount<>round(p_amount,digits) then raise exception 'Adjustment exceeds the invoice currency precision'; end if;
  if p_amount>due-paid then raise exception 'Adjustment exceeds remaining invoice charges'; end if;
  insert into public.fee_adjustments(invoice_id,amount,reason,created_by) values(p_invoice_id,p_amount,trim(p_reason),actor) returning id into result_id;
  insert into public.fee_audit_log(entity_type,entity_id,action,actor_id,details) values('adjustment',result_id,'created',actor,jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'reason',trim(p_reason)));
  return result_id;
end; $$;
revoke all on function public.fee_add_adjustment(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.fee_add_adjustment(uuid,numeric,text) to authenticated;

create function public.fee_record_payment(p_invoice_id uuid,p_amount numeric,p_method text,p_reference text,p_paid_on date,p_notes text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result_id uuid; due numeric; paid numeric; digits smallint;
begin
  actor:=private.fee_require_admin();
  if p_amount is null or p_amount<=0 or length(trim(p_method))<2 or length(trim(p_reference))<2 then raise exception 'Valid positive amount, method, and reference are required'; end if;
  select greatest(0,i.base_amount-coalesce((select sum(amount) from public.fee_adjustments where invoice_id=i.id),0)),coalesce((select sum(amount) from public.fee_payments where invoice_id=i.id and status='verified'),0),i.currency_minor_units into strict due,paid,digits from public.fee_invoices i where i.id=p_invoice_id for update;
  if p_amount<>round(p_amount,digits) then raise exception 'Payment exceeds the invoice currency precision'; end if;
  if p_amount>due-paid then raise exception 'Payment exceeds outstanding balance'; end if;
  insert into public.fee_payments(invoice_id,amount,payment_method,reference_number,paid_on,notes,recorded_by) values(p_invoice_id,p_amount,trim(p_method),trim(p_reference),p_paid_on,coalesce(p_notes,''),actor) returning id into result_id;
  insert into public.fee_audit_log(entity_type,entity_id,action,actor_id,details) values('payment',result_id,'recorded_pending_verification',actor,jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'method',trim(p_method),'reference',trim(p_reference)));
  return result_id;
end; $$;
revoke all on function public.fee_record_payment(uuid,numeric,text,text,date,text) from public,anon,authenticated;
grant execute on function public.fee_record_payment(uuid,numeric,text,text,date,text) to authenticated;

create function public.fee_review_payment(p_payment_id uuid,p_decision text,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.fee_payments; total_due numeric; total_paid numeric;
begin
  actor:=private.fee_require_admin();
  if p_decision not in ('verified','rejected','reversed') then raise exception 'Unsupported payment decision'; end if;
  select * into strict item from public.fee_payments where id=p_payment_id for update;
  if item.recorded_by=actor then raise exception 'A different administrator must review this payment'; end if;
  if (p_decision='verified' and item.status<>'pending_verification') or (p_decision='rejected' and item.status<>'pending_verification') or (p_decision='reversed' and item.status<>'verified') then raise exception 'Payment status does not allow this action'; end if;
  if p_decision='verified' then
    select greatest(0,base_amount-coalesce((select sum(amount) from public.fee_adjustments where invoice_id=i.id),0)),coalesce((select sum(amount) from public.fee_payments where invoice_id=i.id and status='verified'),0)
      into strict total_due,total_paid from public.fee_invoices i where i.id=item.invoice_id for update;
    if item.amount>total_due-total_paid then raise exception 'Payment exceeds the remaining verified balance'; end if;
  end if;
  update public.fee_payments set status=p_decision,verified_by=case when p_decision='verified' then actor else verified_by end,verified_at=case when p_decision='verified' then now() else verified_at end where id=p_payment_id;
  insert into public.fee_audit_log(entity_type,entity_id,action,actor_id,details) values('payment',item.id,p_decision,actor,jsonb_build_object('invoice_id',item.invoice_id,'reason',p_reason));
end; $$;
revoke all on function public.fee_review_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fee_review_payment(uuid,text,text) to authenticated;

commit;
