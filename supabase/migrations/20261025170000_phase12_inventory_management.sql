-- Phase 12: fixed assets and consumable stock, with audited RPC-only mutations.
begin;

do $$ begin
  if to_regclass('public.hostels') is null
     or to_regclass('public.rooms') is null
     or to_regclass('public.complaint_maintenance_tasks') is null
     or to_regprocedure('private.is_complaint_staff()') is null
     or to_regprocedure('private.set_updated_at()') is null then
    raise exception 'Phase 12 inventory requires Phase 1 staff authorization, Phase 2 hostel/room tables, and Phase 7 maintenance tasks';
  end if;
end $$;

create table public.inventory_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null check(length(trim(asset_code)) between 1 and 80),
  name text not null check(length(trim(name)) between 1 and 160),
  category text not null check(length(trim(category)) between 1 and 80),
  quantity integer not null default 1 check(quantity>0),
  hostel_id uuid references public.hostels(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  storage_location text not null default '' check(length(storage_location)<=160),
  purchase_date date,
  purchase_cost numeric(14,3) check(purchase_cost is null or purchase_cost>=0),
  purchase_currency_code text check(purchase_currency_code is null or purchase_currency_code ~ '^[A-Z]{3}$'),
  supplier text check(supplier is null or length(supplier)<=160),
  warranty_until date,
  condition text not null default 'good' check(condition in ('new','good','fair','poor','damaged','unusable')),
  status text not null default 'active' check(status in ('active','under_maintenance','damaged','retired')),
  notes text not null default '' check(length(notes)<=2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  check((purchase_cost is null)=(purchase_currency_code is null)),
  check(warranty_until is null or purchase_date is null or warranty_until>=purchase_date),
  check(room_id is null or hostel_id is not null)
);
create unique index inventory_assets_code_unique on public.inventory_assets(lower(trim(asset_code)));
create index inventory_assets_status_idx on public.inventory_assets(status,condition,updated_at desc);
create index inventory_assets_location_idx on public.inventory_assets(hostel_id,room_id);
create trigger inventory_assets_updated before update on public.inventory_assets
for each row execute function private.set_updated_at();

create table public.inventory_asset_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  event_type text not null check(event_type in ('registered','updated','moved','state_changed','maintenance_linked')),
  actor_id uuid not null references public.profiles(id),
  reason text not null check(length(trim(reason)) between 3 and 500),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  maintenance_task_id uuid references public.complaint_maintenance_tasks(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index inventory_asset_events_asset_idx on public.inventory_asset_events(asset_id,created_at desc);

create table public.inventory_asset_maintenance (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  maintenance_task_id uuid not null references public.complaint_maintenance_tasks(id) on delete restrict,
  linked_by uuid not null references public.profiles(id),
  linked_at timestamptz not null default now(),
  notes text not null default '' check(length(notes)<=1000),
  unique(asset_id,maintenance_task_id)
);
create index inventory_asset_maintenance_task_idx on public.inventory_asset_maintenance(maintenance_task_id);

create table public.inventory_stock_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null check(length(trim(item_code)) between 1 and 80),
  name text not null check(length(trim(name)) between 1 and 160),
  category text not null check(length(trim(category)) between 1 and 80),
  unit text not null check(length(trim(unit)) between 1 and 40),
  quantity_on_hand numeric(14,3) not null default 0 check(quantity_on_hand>=0),
  minimum_quantity numeric(14,3) not null default 0 check(minimum_quantity>=0),
  hostel_id uuid references public.hostels(id) on delete restrict,
  storage_location text not null default '' check(length(storage_location)<=160),
  notes text not null default '' check(length(notes)<=2000),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
create unique index inventory_stock_code_unique on public.inventory_stock_items(lower(trim(item_code)));
create index inventory_stock_low_idx on public.inventory_stock_items(is_active,quantity_on_hand,minimum_quantity);
create trigger inventory_stock_updated before update on public.inventory_stock_items
for each row execute function private.set_updated_at();

create table public.inventory_stock_transactions (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_stock_items(id) on delete restrict,
  transaction_type text not null check(transaction_type in ('received','issued')),
  quantity numeric(14,3) not null check(quantity>0),
  quantity_after numeric(14,3) not null check(quantity_after>=0),
  reason text not null check(length(trim(reason)) between 3 and 500),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index inventory_stock_transactions_item_idx on public.inventory_stock_transactions(item_id,created_at desc);

alter table public.inventory_assets enable row level security;
alter table public.inventory_asset_events enable row level security;
alter table public.inventory_asset_maintenance enable row level security;
alter table public.inventory_stock_items enable row level security;
alter table public.inventory_stock_transactions enable row level security;
revoke all on public.inventory_assets,public.inventory_asset_events,public.inventory_asset_maintenance,public.inventory_stock_items,public.inventory_stock_transactions from anon,authenticated;
grant all on public.inventory_assets,public.inventory_asset_events,public.inventory_asset_maintenance,public.inventory_stock_items,public.inventory_stock_transactions to service_role;

create function private.inventory_require_staff() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_complaint_staff() then
    raise exception 'Active administrator or warden access required' using errcode='42501';
  end if;
  return auth.uid();
end; $$;
revoke all on function private.inventory_require_staff() from public,anon,authenticated;
grant execute on function private.inventory_require_staff() to authenticated;

create function public.inventory_register_asset(p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; aid uuid; hid uuid; rid uuid; state jsonb;
begin
  actor:=private.inventory_require_staff();
  hid:=nullif(p_data->>'hostel_id','')::uuid;
  rid:=nullif(p_data->>'room_id','')::uuid;
  if rid is not null and not exists(select 1 from public.rooms r where r.id=rid and r.hostel_id=hid) then raise exception 'Selected room does not belong to the selected hostel'; end if;
  insert into public.inventory_assets(asset_code,name,category,quantity,hostel_id,room_id,storage_location,purchase_date,purchase_cost,purchase_currency_code,supplier,warranty_until,condition,status,notes,created_by,updated_by)
  values(trim(p_data->>'asset_code'),trim(p_data->>'name'),trim(p_data->>'category'),coalesce((p_data->>'quantity')::integer,1),hid,rid,trim(coalesce(p_data->>'storage_location','')),nullif(p_data->>'purchase_date','')::date,nullif(p_data->>'purchase_cost','')::numeric,nullif(p_data->>'purchase_currency_code',''),nullif(trim(p_data->>'supplier'),''),nullif(p_data->>'warranty_until','')::date,coalesce(nullif(p_data->>'condition',''),'good'),coalesce(nullif(p_data->>'status',''),'active'),coalesce(p_data->>'notes',''),actor,actor)
  returning id into aid;
  select to_jsonb(a) into state from public.inventory_assets a where a.id=aid;
  insert into public.inventory_asset_events(asset_id,event_type,actor_id,reason,after_state) values(aid,'registered',actor,'Asset registered',state);
  return aid;
end; $$;
revoke all on function public.inventory_register_asset(jsonb) from public,anon,authenticated;
grant execute on function public.inventory_register_asset(jsonb) to authenticated;

create function public.inventory_update_asset(p_id uuid,p_data jsonb,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.inventory_assets; previous jsonb; next_row public.inventory_assets;
begin
  actor:=private.inventory_require_staff();
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Provide a reason for the asset update'; end if;
  select * into strict item from public.inventory_assets where id=p_id for update;
  previous:=to_jsonb(item);
  update public.inventory_assets set
    asset_code=trim(coalesce(p_data->>'asset_code',item.asset_code)),
    name=trim(coalesce(p_data->>'name',item.name)),
    category=trim(coalesce(p_data->>'category',item.category)),
    quantity=coalesce((p_data->>'quantity')::integer,item.quantity),
    purchase_date=case when p_data ? 'purchase_date' then nullif(p_data->>'purchase_date','')::date else item.purchase_date end,
    purchase_cost=case when p_data ? 'purchase_cost' then nullif(p_data->>'purchase_cost','')::numeric else item.purchase_cost end,
    purchase_currency_code=case when p_data ? 'purchase_currency_code' then nullif(p_data->>'purchase_currency_code','') else item.purchase_currency_code end,
    supplier=case when p_data ? 'supplier' then nullif(trim(p_data->>'supplier'),'') else item.supplier end,
    warranty_until=case when p_data ? 'warranty_until' then nullif(p_data->>'warranty_until','')::date else item.warranty_until end,
    notes=case when p_data ? 'notes' then coalesce(p_data->>'notes','') else item.notes end,
    updated_by=actor
  where id=p_id returning * into next_row;
  insert into public.inventory_asset_events(asset_id,event_type,actor_id,reason,before_state,after_state)
  values(p_id,'updated',actor,trim(p_reason),previous,to_jsonb(next_row));
end; $$;
revoke all on function public.inventory_update_asset(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.inventory_update_asset(uuid,jsonb,text) to authenticated;

create function public.inventory_move_asset(p_id uuid,p_hostel_id uuid,p_room_id uuid,p_location text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.inventory_assets; previous jsonb; next_row public.inventory_assets;
begin
  actor:=private.inventory_require_staff();
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Provide a reason for the asset movement'; end if;
  if p_hostel_id is not null and not exists(select 1 from public.hostels where id=p_hostel_id and status='active') then raise exception 'Active hostel location required'; end if;
  if p_room_id is not null and not exists(select 1 from public.rooms where id=p_room_id and hostel_id=p_hostel_id) then raise exception 'Selected room does not belong to the selected hostel'; end if;
  select * into strict item from public.inventory_assets where id=p_id for update;
  previous:=jsonb_build_object('hostel_id',item.hostel_id,'room_id',item.room_id,'storage_location',item.storage_location);
  update public.inventory_assets set hostel_id=p_hostel_id,room_id=p_room_id,storage_location=trim(coalesce(p_location,'')),updated_by=actor where id=p_id returning * into next_row;
  insert into public.inventory_asset_events(asset_id,event_type,actor_id,reason,before_state,after_state)
  values(p_id,'moved',actor,trim(p_reason),previous,jsonb_build_object('hostel_id',next_row.hostel_id,'room_id',next_row.room_id,'storage_location',next_row.storage_location));
end; $$;
revoke all on function public.inventory_move_asset(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.inventory_move_asset(uuid,uuid,uuid,text,text) to authenticated;

create function public.inventory_set_asset_state(p_id uuid,p_condition text,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.inventory_assets;
begin
  actor:=private.inventory_require_staff();
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Provide a reason for the condition or status change'; end if;
  if p_condition not in ('new','good','fair','poor','damaged','unusable') or p_status not in ('active','under_maintenance','damaged','retired') then raise exception 'Unsupported asset condition or status'; end if;
  select * into strict item from public.inventory_assets where id=p_id for update;
  update public.inventory_assets set condition=p_condition,status=p_status,updated_by=actor where id=p_id;
  insert into public.inventory_asset_events(asset_id,event_type,actor_id,reason,before_state,after_state)
  values(p_id,'state_changed',actor,trim(p_reason),jsonb_build_object('condition',item.condition,'status',item.status),jsonb_build_object('condition',p_condition,'status',p_status));
end; $$;
revoke all on function public.inventory_set_asset_state(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.inventory_set_asset_state(uuid,text,text,text) to authenticated;

create function public.inventory_link_maintenance(p_asset_id uuid,p_task_id uuid,p_notes text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.inventory_assets; task public.complaint_maintenance_tasks; link_id uuid;
begin
  actor:=private.inventory_require_staff();
  if length(coalesce(p_notes,''))>1000 then raise exception 'Link notes are too long'; end if;
  select * into strict item from public.inventory_assets where id=p_asset_id for update;
  select * into strict task from public.complaint_maintenance_tasks where id=p_task_id;
  insert into public.inventory_asset_maintenance(asset_id,maintenance_task_id,linked_by,notes)
  values(p_asset_id,p_task_id,actor,coalesce(p_notes,'')) on conflict(asset_id,maintenance_task_id) do nothing returning id into link_id;
  if link_id is null then select id into strict link_id from public.inventory_asset_maintenance where asset_id=p_asset_id and maintenance_task_id=p_task_id; return link_id; end if;
  if item.status not in ('retired','under_maintenance') and task.status in ('open','scheduled','in_progress') then
    update public.inventory_assets set status='under_maintenance',updated_by=actor where id=p_asset_id;
  end if;
  insert into public.inventory_asset_events(asset_id,event_type,actor_id,reason,maintenance_task_id,before_state,after_state)
  values(p_asset_id,'maintenance_linked',actor,'Linked existing maintenance task',p_task_id,jsonb_build_object('status',item.status),jsonb_build_object('status',case when task.status in ('open','scheduled','in_progress') then 'under_maintenance' else item.status end));
  return link_id;
end; $$;
revoke all on function public.inventory_link_maintenance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.inventory_link_maintenance(uuid,uuid,text) to authenticated;

create function public.inventory_register_stock_item(p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; item_id uuid;
begin
  actor:=private.inventory_require_staff();
  insert into public.inventory_stock_items(item_code,name,category,unit,minimum_quantity,hostel_id,storage_location,notes,created_by,updated_by)
  values(trim(p_data->>'item_code'),trim(p_data->>'name'),trim(p_data->>'category'),trim(p_data->>'unit'),coalesce(nullif(p_data->>'minimum_quantity','')::numeric,0),nullif(p_data->>'hostel_id','')::uuid,trim(coalesce(p_data->>'storage_location','')),coalesce(p_data->>'notes',''),actor,actor)
  returning id into item_id;
  return item_id;
end; $$;
revoke all on function public.inventory_register_stock_item(jsonb) from public,anon,authenticated;
grant execute on function public.inventory_register_stock_item(jsonb) to authenticated;

create function public.inventory_stock_adjust(p_item_id uuid,p_type text,p_quantity numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; item public.inventory_stock_items; next_qty numeric(14,3);
begin
  actor:=private.inventory_require_staff();
  if p_type not in ('received','issued') or p_quantity is null or p_quantity<=0 or p_reason is null or length(trim(p_reason))<3 then raise exception 'Valid stock action, positive quantity, and reason are required'; end if;
  select * into strict item from public.inventory_stock_items where id=p_item_id and is_active for update;
  if p_type='issued' and item.quantity_on_hand<p_quantity then raise exception 'Cannot issue more stock than is available'; end if;
  next_qty:=case when p_type='received' then item.quantity_on_hand+p_quantity else item.quantity_on_hand-p_quantity end;
  update public.inventory_stock_items set quantity_on_hand=next_qty,updated_by=actor where id=p_item_id;
  insert into public.inventory_stock_transactions(item_id,transaction_type,quantity,quantity_after,reason,actor_id)
  values(p_item_id,p_type,p_quantity,next_qty,trim(p_reason),actor);
  return jsonb_build_object('item_id',p_item_id,'quantity_on_hand',next_qty,'low_stock',next_qty<=item.minimum_quantity);
end; $$;
revoke all on function public.inventory_stock_adjust(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.inventory_stock_adjust(uuid,text,numeric,text) to authenticated;

create function public.inventory_list_assets(p_search text default '',p_category text default '',p_status text default '',p_condition text default '',p_hostel_id uuid default null,p_page integer default 0,p_page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer; actor uuid; term text;
begin
  actor:=private.inventory_require_staff();
  if p_page<0 or p_page_size not between 1 and 100 then raise exception 'Invalid page'; end if;
  if p_status<>'' and p_status not in ('active','under_maintenance','damaged','retired') then raise exception 'Invalid asset status'; end if;
  if p_condition<>'' and p_condition not in ('new','good','fair','poor','damaged','unusable') then raise exception 'Invalid asset condition'; end if;
  term:=left(trim(coalesce(p_search,'')),100);
  select count(*) into total from public.inventory_assets a where (p_category='' or a.category=p_category) and (p_status='' or a.status=p_status) and (p_condition='' or a.condition=p_condition) and (p_hostel_id is null or a.hostel_id=p_hostel_id) and (term='' or a.asset_code ilike '%'||term||'%' or a.name ilike '%'||term||'%' or a.category ilike '%'||term||'%');
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into result from (
    select a.*,h.name hostel_name,h.block hostel_block,r.room_number,
      (select count(*) from public.inventory_asset_maintenance am where am.asset_id=a.id) maintenance_record_count,
      coalesce((select jsonb_agg(jsonb_build_object('maintenance_task_id',t.id,'complaint_id',c.id,'complaint_number',c.complaint_number,'task_status',t.status,'actual_cost',t.actual_cost,'currency_code',t.cost_currency_code,'linked_at',am.linked_at) order by am.linked_at desc)
        from public.inventory_asset_maintenance am join public.complaint_maintenance_tasks t on t.id=am.maintenance_task_id join public.complaints c on c.id=t.complaint_id where am.asset_id=a.id),'[]'::jsonb) maintenance
    from public.inventory_assets a left join public.hostels h on h.id=a.hostel_id left join public.rooms r on r.id=a.room_id
    where (p_category='' or a.category=p_category) and (p_status='' or a.status=p_status) and (p_condition='' or a.condition=p_condition) and (p_hostel_id is null or a.hostel_id=p_hostel_id) and (term='' or a.asset_code ilike '%'||term||'%' or a.name ilike '%'||term||'%' or a.category ilike '%'||term||'%')
    order by a.updated_at desc,a.id offset (p_page*p_page_size) limit p_page_size
  ) rows;
  return jsonb_build_object('rows',result,'count',total,'page',p_page,'page_size',p_page_size);
end; $$;
revoke all on function public.inventory_list_assets(text,text,text,text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.inventory_list_assets(text,text,text,text,uuid,integer,integer) to authenticated;

create function public.inventory_asset_history(p_asset_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.inventory_require_staff();
  if not exists(select 1 from public.inventory_assets where id=p_asset_id) then raise exception 'Asset not found'; end if;
  select jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object('event_type',e.event_type,'actor_name',p.full_name,'reason',e.reason,'before_state',e.before_state,'after_state',e.after_state,'maintenance_task_id',e.maintenance_task_id,'created_at',e.created_at) order by e.created_at desc) from public.inventory_asset_events e join public.profiles p on p.id=e.actor_id where e.asset_id=p_asset_id),'[]'::jsonb),
    'maintenance',coalesce((select jsonb_agg(jsonb_build_object('link_id',am.id,'task_id',t.id,'complaint_id',c.id,'complaint_number',c.complaint_number,'complaint_title',c.title,'status',t.status,'work_notes',t.work_notes,'scheduled_visit_at',t.scheduled_visit_at,'estimated_cost',t.estimated_cost,'actual_cost',t.actual_cost,'currency_code',t.cost_currency_code,'linked_at',am.linked_at,'linked_by',p.full_name,'link_notes',am.notes) order by am.linked_at desc) from public.inventory_asset_maintenance am join public.complaint_maintenance_tasks t on t.id=am.maintenance_task_id join public.complaints c on c.id=t.complaint_id join public.profiles p on p.id=am.linked_by where am.asset_id=p_asset_id),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.inventory_asset_history(uuid) from public,anon,authenticated;
grant execute on function public.inventory_asset_history(uuid) to authenticated;

create function public.inventory_maintenance_options(p_search text default '',p_page integer default 0,p_page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer; term text;
begin
  perform private.inventory_require_staff();
  if p_page<0 or p_page_size not between 1 and 100 then raise exception 'Invalid page'; end if;
  term:=left(trim(coalesce(p_search,'')),100);
  select count(*) into total from public.complaint_maintenance_tasks t join public.complaints c on c.id=t.complaint_id where (term='' or c.complaint_number ilike '%'||term||'%' or c.title ilike '%'||term||'%');
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into result from (
    select t.id task_id,t.complaint_id,c.complaint_number,c.title complaint_title,t.status,t.scheduled_visit_at,t.actual_cost,t.cost_currency_code
    from public.complaint_maintenance_tasks t join public.complaints c on c.id=t.complaint_id
    where (term='' or c.complaint_number ilike '%'||term||'%' or c.title ilike '%'||term||'%')
    order by t.updated_at desc offset (p_page*p_page_size) limit p_page_size
  ) rows;
  return jsonb_build_object('rows',result,'count',total,'page',p_page,'page_size',p_page_size);
end; $$;
revoke all on function public.inventory_maintenance_options(text,integer,integer) from public,anon,authenticated;
grant execute on function public.inventory_maintenance_options(text,integer,integer) to authenticated;

create function public.inventory_list_stock_items(p_search text default '',p_category text default '',p_low_only boolean default false,p_page integer default 0,p_page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer; term text;
begin
  perform private.inventory_require_staff();
  if p_page<0 or p_page_size not between 1 and 100 then raise exception 'Invalid page'; end if;
  term:=left(trim(coalesce(p_search,'')),100);
  select count(*) into total from public.inventory_stock_items i where i.is_active and (p_category='' or i.category=p_category) and (not p_low_only or i.quantity_on_hand<=i.minimum_quantity) and (term='' or i.item_code ilike '%'||term||'%' or i.name ilike '%'||term||'%' or i.category ilike '%'||term||'%');
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into result from (
    select i.*,h.name hostel_name,h.block hostel_block,(i.quantity_on_hand<=i.minimum_quantity) low_stock
    from public.inventory_stock_items i left join public.hostels h on h.id=i.hostel_id
    where i.is_active and (p_category='' or i.category=p_category) and (not p_low_only or i.quantity_on_hand<=i.minimum_quantity) and (term='' or i.item_code ilike '%'||term||'%' or i.name ilike '%'||term||'%' or i.category ilike '%'||term||'%')
    order by low_stock desc,i.name offset (p_page*p_page_size) limit p_page_size
  ) rows;
  return jsonb_build_object('rows',result,'count',total,'page',p_page,'page_size',p_page_size);
end; $$;
revoke all on function public.inventory_list_stock_items(text,text,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.inventory_list_stock_items(text,text,boolean,integer,integer) to authenticated;

create function public.inventory_list_stock_transactions(p_item_id uuid default null,p_page integer default 0,p_page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total integer;
begin
  perform private.inventory_require_staff();
  if p_page<0 or p_page_size not between 1 and 100 then raise exception 'Invalid page'; end if;
  select count(*) into total from public.inventory_stock_transactions t where p_item_id is null or t.item_id=p_item_id;
  select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) into result from (
    select t.*,i.item_code,i.name item_name,i.unit,p.full_name actor_name from public.inventory_stock_transactions t join public.inventory_stock_items i on i.id=t.item_id join public.profiles p on p.id=t.actor_id
    where p_item_id is null or t.item_id=p_item_id order by t.created_at desc offset (p_page*p_page_size) limit p_page_size
  ) rows;
  return jsonb_build_object('rows',result,'count',total,'page',p_page,'page_size',p_page_size);
end; $$;
revoke all on function public.inventory_list_stock_transactions(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.inventory_list_stock_transactions(uuid,integer,integer) to authenticated;

create function public.inventory_dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.inventory_require_staff();
  return jsonb_build_object(
    'total_asset_records',(select count(*) from public.inventory_assets),
    'asset_units',(select coalesce(sum(quantity),0) from public.inventory_assets),
    'assets_in_service',(select count(*) from public.inventory_assets where status='active'),
    'assets_under_maintenance',(select count(*) from public.inventory_assets where status='under_maintenance'),
    'assets_damaged_or_unusable',(select count(*) from public.inventory_assets where status='damaged' or condition in ('damaged','unusable')),
    'retired_assets',(select count(*) from public.inventory_assets where status='retired'),
    'low_stock_items',(select count(*) from public.inventory_stock_items where is_active and quantity_on_hand<=minimum_quantity),
    'recently_added_assets',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select asset_code,name,status,created_at,updated_at from public.inventory_assets order by created_at desc limit 5) r),
    'recently_updated_assets',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select asset_code,name,status,created_at,updated_at from public.inventory_assets order by updated_at desc limit 5) r)
  );
end; $$;
revoke all on function public.inventory_dashboard_metrics() from public,anon,authenticated;
grant execute on function public.inventory_dashboard_metrics() to authenticated;

commit;
