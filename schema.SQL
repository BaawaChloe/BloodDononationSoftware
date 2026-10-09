
create sequence donor_seq; create sequence donation_seq;

create table roles (id int generated always as identity primary key, name text unique not null);
create table users (id uuid primary key default gen_random_uuid(), full_name text not null, email text unique not null,
  role_id int not null references roles(id), is_active boolean not null default true);
create table blood_types (id int generated always as identity primary key, code text unique not null, is_active boolean not null default true);

create table donors (
  id bigint generated always as identity primary key,
  donor_number text unique not null default 'D-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('donor_seq')::text, 5, '0'),
  full_name text not null, date_of_birth date not null,
  sex text not null check (sex in ('Male', 'Female')),
  contact_number text not null, email text, address text, emergency_contact text,
  blood_type_id int references blood_types(id),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  registered_at date not null default current_date);

create table donations (
  id bigint generated always as identity primary key,
  donation_number text unique not null default 'DN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('donation_seq')::text, 5, '0'),
  donor_id bigint not null references donors(id),
  blood_type_id int not null references blood_types(id),
  donation_date date not null, volume_ml int not null default 450 check (volume_ml > 0), remarks text,
  status text not null default 'Pending' check (status in ('Pending', 'Completed', 'Cancelled')));

create table donation_screening (
  id bigint generated always as identity primary key,
  donation_id bigint not null unique references donations(id),
  screening_date date not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Deferred', 'Rejected')),
  result text, reviewer text, remarks text);

create index on donors (full_name); create index on donors (contact_number);
create index on donors (blood_type_id); create index on donations (donor_id);

insert into blood_types (code) values ('A+'),('A-'),('B+'),('B-'),('AB+'),('AB-'),('O+'),('O-');
insert into roles (name) values ('Administrator'),('Donor Officer'),('Donation Staff'),('Screening Staff'),
  ('Inventory Officer'),('Request Officer'),('Release Officer'),('Management');
insert into users (full_name, email, role_id) values ('System Administrator', 'admin@example.com', (select id from roles where name = 'Administrator'));

-- DEV-ONLY access: anyone holding the anon key can read/write. Replace in Labs 35-37 (login + roles) before real data.
grant usage on all sequences in schema public to anon;
do $$ declare t text; begin
  foreach t in array array['roles','users','blood_types','donors','donations','donation_screening'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy dev_all on %I for all to anon using (true) with check (true)', t);
  end loop; end $$;
