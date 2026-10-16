-- BDMS Labs 11-20: run once in Supabase > SQL Editor, AFTER schema.sql
create sequence unit_seq; create sequence request_seq;
alter table donations add column recorded_by text;

insert into users (full_name, email, role_id)
select v.n, v.e, r.id from (values ('Demo Donation Staff','donation@example.com','Donation Staff'),('Demo Screening Staff','screening@example.com','Screening Staff'),
  ('Demo Inventory Officer','inventory@example.com','Inventory Officer'),('Demo Request Officer','request@example.com','Request Officer')) v(n, e, rn) join roles r on r.name = v.rn;

create table blood_units (
  id bigint generated always as identity primary key,
  unit_number text unique not null default 'BU-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('unit_seq')::text, 5, '0'),
  donation_id bigint not null unique references donations(id),
  blood_type_id int not null references blood_types(id),
  collection_date date not null, expiration_date date not null,
  component_type text not null default 'Whole Blood' check (component_type in ('Whole Blood','Red Cells','Plasma','Platelets')),
  inventory_status text not null default 'Available' check (inventory_status in ('Available','Reserved','Released','Expired','Discarded')),
  storage_location text not null, handled_by text, remarks text);

create table inventory_transactions (
  id bigint generated always as identity primary key,
  unit_id bigint not null references blood_units(id),
  transaction_type text not null check (transaction_type in ('Added','Reserved','Released','Expired','Discarded','Adjusted')),
  quantity int not null default 1, performed_by text, reference_number text, remarks text,
  created_at timestamptz not null default now());

create table requesters (
  id bigint generated always as identity primary key, name text unique not null, contact_person text not null, contact_number text not null,
  email text, address text, status text not null default 'Active' check (status in ('Active','Inactive')));

create table blood_requests (
  id bigint generated always as identity primary key,
  request_number text unique not null default 'BR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('request_seq')::text, 5, '0'),
  requester_id bigint not null references requesters(id), request_date date not null default current_date,
  patient_reference text not null, urgency text not null default 'Routine' check (urgency in ('Routine','Urgent','Emergency')),
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Cancelled','Fulfilled')),
  purpose text not null, remarks text);

create index on blood_units (blood_type_id); create index on blood_units (inventory_status); create index on inventory_transactions (unit_id);

-- Lab 11: donation rules (donor active, blood type available)
create function donation_before() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from donors where id = new.donor_id and status = 'Active') then raise exception 'Donor must exist and be Active'; end if;
  if not exists (select 1 from blood_types where id = new.blood_type_id and is_active) then raise exception 'Blood type is not available'; end if;
  return new; end $$;
create trigger donation_before_t before insert on donations for each row execute function donation_before();

-- Lab 11: only authorized staff may screen; enforce the status flow
create function screening_before() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from users u join roles r on r.id = u.role_id where u.is_active and u.full_name = new.reviewer and r.name in ('Administrator','Screening Staff')) then
    raise exception 'Only authorized screening staff can update screening'; end if;
  if tg_op = 'UPDATE' and new.status <> old.status and not ((old.status = 'Pending' and new.status in ('Approved','Deferred','Rejected')) or (old.status = 'Deferred' and new.status in ('Approved','Rejected'))) then
    raise exception 'Invalid screening change: % to %', old.status, new.status; end if;
  return new; end $$;
create trigger screening_before_t before insert or update on donation_screening for each row execute function screening_before();

-- Labs 13, 15: a unit needs an Approved screening; copies type and date from the donation; sets expiry (assumed shelf life: whole blood 35 d, red cells 42 d, platelets 5 d, plasma 365 d)
create function unit_before() returns trigger language plpgsql as $$
declare d donations%rowtype;
begin
  select * into d from donations where id = new.donation_id;
  if not exists (select 1 from donation_screening where donation_id = new.donation_id and status = 'Approved') then
    raise exception 'Donation needs an Approved screening before it can enter inventory'; end if;
  new.blood_type_id := d.blood_type_id; new.collection_date := d.donation_date;
  new.expiration_date := d.donation_date + case new.component_type when 'Platelets' then 5 when 'Plasma' then 365 when 'Red Cells' then 42 else 35 end;
  return new; end $$;
create trigger unit_before_t before insert on blood_units for each row execute function unit_before();

-- Labs 15-16: complete the donation and log every inventory movement
create function unit_after() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update donations set status = 'Completed' where id = new.donation_id;
    insert into inventory_transactions (unit_id, transaction_type, performed_by, reference_number) values (new.id, 'Added', new.handled_by, new.unit_number);
  elsif new.inventory_status <> old.inventory_status then
    insert into inventory_transactions (unit_id, transaction_type, performed_by, reference_number, remarks)
    values (new.id, case new.inventory_status when 'Available' then 'Adjusted' else new.inventory_status end, new.handled_by, new.unit_number, new.remarks);
  end if;
  return null; end $$;
create trigger unit_after_t after insert or update on blood_units for each row execute function unit_after();

-- DEV-ONLY access, same as schema.sql (replace in Labs 35-37)
grant usage on all sequences in schema public to anon;
do $$ declare t text; begin
  foreach t in array array['blood_units','inventory_transactions','requesters','blood_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy dev_all on %I for all to anon using (true) with check (true)', t);
  end loop; end $$;
