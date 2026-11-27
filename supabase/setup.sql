-- Rhedr: sublets database.
-- Paste this whole file into Supabase, SQL Editor, New query, then press Run.
-- Running it again is safe.

-- 1. Sublet listings ------------------------------------------------------
create table if not exists public.sublets (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind          text not null default 'sublet' check (kind in ('sublet','takeover')),
  space         text not null default 'room' check (space in ('room','unit')),
  title         text not null check (char_length(title) between 4 and 80),
  building_id   int,                        -- id from data/listings.json, when it is a known building
  building_name text,
  address       text not null check (char_length(address) between 3 and 120),
  unit          text,                       -- shown only after the viewer signs in
  lat           double precision not null,
  lng           double precision not null,
  beds          int not null check (beds between 0 and 8),
  baths         numeric(3,1),
  price         int not null check (price between 50 and 6000),      -- per month, what the subletter pays
  orig_price    int check (orig_price is null or orig_price between 50 and 6000),
  start_date    date not null,
  end_date      date not null,
  furnished     boolean not null default false,
  utilities     boolean not null default false,
  roommates     text,
  description   text not null check (char_length(description) between 20 and 2000),
  photos        text[] not null default '{}',
  contact_name  text,
  has_lease_doc boolean not null default false,
  lease_verified boolean not null default false,   -- set by an admin after checking the lease proof
  flags         text[] not null default '{}',      -- scam-check results
  status        text not null default 'live' check (status in ('live','review','taken','removed')),
  constraint dates_ok check (end_date > start_date)
);
alter table public.sublets add column if not exists lease_path text;   -- private: where the lease proof is stored
create index if not exists sublets_live on public.sublets (status, end_date);

-- Penn State's local date (the database clock runs on UTC)
create or replace function public.local_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;

-- 2. Reports from students ------------------------------------------------
create table if not exists public.sublet_reports (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  sublet_id  bigint not null references public.sublets(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason     text not null check (char_length(reason) between 3 and 500),
  unique (sublet_id, user_id)
);

-- 3. Helper: is the signed-in person on a confirmed Penn State email? ------
create or replace function public.is_psu() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email') ~ '^[^@]+@psu\.edu$', false)
     and exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;

-- How many files the signed-in person has stored in a bucket (used by the upload limit)
create or replace function public.my_file_count(bucket text) returns int
language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects o
   where o.bucket_id = bucket and (storage.foldername(o.name))[1] = auth.uid()::text
$$;
revoke all on function public.my_file_count(text) from public, anon;
grant execute on function public.my_file_count(text) to authenticated;

-- Site switches. Change them on rhedr.com/admin (or here in Table Editor, table site_settings).
create table if not exists public.site_settings (
  id                   int primary key default 1 check (id = 1),
  lease_proof_required boolean not null default false,  -- false: optional, with a Lease checked badge. true: every post needs one and waits for the check
  auto_approve_green   boolean not null default false,  -- true: when the AI check finds everything matches, the badge goes on without waiting for you
  updated_at           timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
alter table public.site_settings enable row level security;
drop policy if exists "settings: anyone can read" on public.site_settings;
create policy "settings: anyone can read" on public.site_settings for select to anon, authenticated using (true);
grant select on public.site_settings to anon, authenticated;
create or replace function public.lease_required() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lease_proof_required from public.site_settings where id = 1), false) $$;

-- 4. Scam checks, run by the database on every new or edited listing -------
create or replace function public.sublet_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  txt text := lower(coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' ' || coalesce(new.roommates,''));
  f text[] := '{}';
  active int;
  p text;
begin
  -- people outside Penn State can't post
  if not public.is_psu() then raise exception 'Sign in with a confirmed @psu.edu email to post'; end if;
  new.user_id := auth.uid();
  -- only an admin (in the dashboard) can set these
  if tg_op = 'INSERT' then new.lease_verified := false; new.created_at := now();
  else new.lease_verified := old.lease_verified; new.created_at := old.created_at; end if;

  -- the pin has to be in the State College area
  if new.lat not between 40.70 and 40.90 or new.lng not between -78.05 and -77.70 then
    raise exception 'That address is not in the State College area'; end if;

  -- photos: at most 10, and each one must be a file this person uploaded to sublet-photos
  if tg_op = 'INSERT' or new.photos is distinct from old.photos then
    if coalesce(array_length(new.photos, 1), 0) > 10 then raise exception 'Up to 10 photos per sublet'; end if;
    foreach p in array new.photos loop
      if p !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/sublet-photos/' || auth.uid()::text || '/[A-Za-z0-9._-]+$')
         or not exists (select 1 from storage.objects o where o.bucket_id = 'sublet-photos'
                          and o.name = substring(p from '/sublet-photos/(.+)$')) then
        raise exception 'Photos have to be uploaded through the site'; end if;
    end loop;
  end if;

  -- lease proof: only counts if the file is really in this person's lease-proofs folder.
  -- A listing without one can get one later (also after a rejected proof), but a proof can't be swapped once sent.
  if tg_op = 'INSERT' or (not old.has_lease_doc and new.lease_path is distinct from old.lease_path) then
    new.has_lease_doc := new.lease_path is not null
      and (storage.foldername(new.lease_path))[1] = auth.uid()::text
      and exists (select 1 from storage.objects o where o.bucket_id = 'lease-proofs' and o.name = new.lease_path);
    if not new.has_lease_doc then new.lease_path := null; end if;
  else new.has_lease_doc := old.has_lease_doc; new.lease_path := old.lease_path; end if;
  -- when lease proof is required (site_settings), a post needs one and stays hidden until it's checked
  if tg_op = 'INSERT' and public.lease_required() then
    if not new.has_lease_doc then raise exception 'Add proof that you live there (a lease page or a bill) to post a sublet'; end if;
    new.status := 'review';
  end if;

  if txt ~ '(western union|moneygram|wire (the|a|me)|wire transfer|gift ?card|bitcoin|crypto|usdt|cashier.?s check|money order)' then f := array_append(f, 'payment'); end if;
  if txt ~ '(whats ?app|telegram|signal app|text me at|kik)' then f := array_append(f, 'offsite'); end if;
  if txt ~ '(out of (the )?(country|state)|overseas|abroad|military deploy|missionary|god bless|can.?t show|no viewing|keys? (will be )?(mailed|shipped|sent))' then f := array_append(f, 'story'); end if;
  if txt ~ '(deposit|pay|payment).{0,40}(before|to hold|first|today)' then f := array_append(f, 'deposit'); end if;
  if new.orig_price is not null and new.price < new.orig_price * 0.35 then f := array_append(f, 'price'); end if;

  if tg_op = 'INSERT' then
    select count(*) into active from public.sublets s where s.user_id = auth.uid() and s.status in ('live','review') and s.end_date >= public.local_today();
    if active >= 3 then raise exception 'You already have 3 active sublets. Mark one as taken first.'; end if;
    if (select count(*) from public.sublets s where s.user_id = auth.uid() and s.created_at > now() - interval '1 day') >= 5 then
      raise exception 'Too many posts today. Try again tomorrow.'; end if;
  end if;

  if tg_op = 'UPDATE' and 'reported' = any(old.flags) then f := array_append(f, 'reported'); end if;
  new.flags := f;
  -- listings that trip a payment, off-site or story check wait for an admin
  if new.status = 'live' and (f && array['payment','offsite','story','deposit']) then new.status := 'review'; end if;
  -- a listing waiting for review or removed by an admin stays that way; only an admin (in the dashboard) can change it.
  -- The poster can still delete it.
  if tg_op = 'UPDATE' and old.status in ('review','removed') then new.status := old.status; end if;
  return new;
end $$;
drop trigger if exists sublet_checks on public.sublets;
create trigger sublet_checks before insert or update on public.sublets
  for each row when (current_user in ('authenticated','anon')) execute function public.sublet_checks();

-- 5. Three reports from different students hide a listing until an admin looks
create or replace function public.sublet_reported() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.sublet_reports r where r.sublet_id = new.sublet_id) >= 3 then
    update public.sublets set status = 'review', flags = array_append(flags, 'reported')
     where id = new.sublet_id and status = 'live';
  end if;
  return new;
end $$;
drop trigger if exists sublet_reported on public.sublet_reports;
create trigger sublet_reported after insert on public.sublet_reports
  for each row execute function public.sublet_reported();

-- 6. Contact details: only signed-in Penn State students can see them --------
create or replace function public.sublet_contact(sid bigint)
returns table (email text, contact_name text, unit text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_psu() then raise exception 'Sign in with your Penn State email to contact the poster'; end if;
  return query select u.email::text, s.contact_name, s.unit
    from public.sublets s join auth.users u on u.id = s.user_id
   where s.id = sid and s.status = 'live';
end $$;
revoke all on function public.sublet_contact(bigint) from public, anon;
grant execute on function public.sublet_contact(bigint) to authenticated;

-- 7. Public view: what anyone browsing can see (no email, no unit number) ---
create or replace view public.sublets_public with (security_invoker = false) as
  select id, created_at, kind, space, title, building_id, building_name, address, lat, lng, beds, baths,
         price, orig_price, start_date, end_date, furnished, utilities, roommates, description, photos,
         contact_name, has_lease_doc, lease_verified
    from public.sublets
   where status = 'live' and end_date >= public.local_today();
grant select on public.sublets_public to anon, authenticated;

-- 8. Row level security -----------------------------------------------------
alter table public.sublets enable row level security;
alter table public.sublet_reports enable row level security;

drop policy if exists "own sublets: read" on public.sublets;
create policy "own sublets: read" on public.sublets for select to authenticated using (user_id = auth.uid());
drop policy if exists "own sublets: add" on public.sublets;
create policy "own sublets: add" on public.sublets for insert to authenticated with check (user_id = auth.uid() and public.is_psu());
drop policy if exists "own sublets: edit" on public.sublets;
create policy "own sublets: edit" on public.sublets for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own sublets: delete" on public.sublets;
create policy "own sublets: delete" on public.sublets for delete to authenticated using (user_id = auth.uid());

drop policy if exists "reports: add" on public.sublet_reports;
create policy "reports: add" on public.sublet_reports for insert to authenticated with check (user_id = auth.uid() and public.is_psu());

revoke all on public.sublets from anon;
grant select, insert, update, delete on public.sublets to authenticated;
grant insert on public.sublet_reports to authenticated;

-- 9. Photo storage ------------------------------------------------------------
-- sublet-photos: public pictures. lease-proofs: private, only you (the admin) can open them in the dashboard.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sublet-photos','sublet-photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lease-proofs','lease-proofs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "sublet photos: upload own" on storage.objects;
create policy "sublet photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id in ('sublet-photos','lease-proofs') and (storage.foldername(name))[1] = auth.uid()::text and public.is_psu()
              -- upload limits per student: 40 photos (3 listings x 10, plus spares), 10 lease proofs
              and public.my_file_count(bucket_id) < case bucket_id when 'sublet-photos' then 40 else 10 end);
-- students can see their own files (Supabase needs this to delete them when a sublet is deleted)
drop policy if exists "sublet photos: read own" on storage.objects;
create policy "sublet photos: read own" on storage.objects for select to authenticated
  using (bucket_id in ('sublet-photos','lease-proofs') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "sublet photos: delete own" on storage.objects;
create policy "sublet photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id in ('sublet-photos','lease-proofs') and (storage.foldername(name))[1] = auth.uid()::text);

-- Who can review lease proofs (rhedr.com/admin). Any confirmed email listed here, for example boaz@rhedr.com.
create table if not exists public.admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- no policies: only the dashboard can read or change it
insert into public.admins (email) values ('boaz@rhedr.com') on conflict do nothing;

-- 10. Only psu.edu emails (and the admins above) can make an account -----------------------------------
-- Supabase calls this before it creates a new user (and before it emails a code).
-- Turn it on in the dashboard: Authentication, Auth Hooks, Before User Created (see SUBLETS-SETUP.md).
create or replace function public.hook_psu_only(event jsonb) returns jsonb
language plpgsql as $$
begin
  -- psu.edu students, plus the admin emails listed in public.admins (like boaz@rhedr.com)
  if coalesce(lower(event -> 'user' ->> 'email'), '') ~ '^[^@]+@psu\.edu$'
     or exists (select 1 from public.admins a where a.email = lower(event -> 'user' ->> 'email')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Only Penn State (@psu.edu) emails can sign up.'));
end $$;
grant execute on function public.hook_psu_only(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.admins to supabase_auth_admin;
drop policy if exists "admins: sign-up hook can read" on public.admins;
create policy "admins: sign-up hook can read" on public.admins for select to supabase_auth_admin using (true);
revoke execute on function public.hook_psu_only(jsonb) from public, anon, authenticated;

-- 11. Lease checks -------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a join auth.users u on lower(u.email) = a.email
                  where u.id = auth.uid() and u.email_confirmed_at is not null
                    and a.email = lower(auth.jwt() ->> 'email')) $$;
-- admins, or the check-lease Edge Function (which runs with the service role key)
create or replace function public.can_review() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role' or coalesce(current_setting('role', true), '') = 'service_role'
      or public.is_admin() $$;

-- One row per lease proof sent. The file itself is deleted once it's been checked; the row keeps what was read from it.
create table if not exists public.lease_checks (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  sublet_id       bigint not null references public.sublets(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  file_path       text,                          -- in the lease-proofs bucket; empty once the file is deleted
  result          text not null default 'waiting' check (result in ('waiting','green','yellow','red')),
  reasons         text[] not null default '{}',  -- why it is yellow or red
  extracted       jsonb,                         -- what the AI read: address, dates, rent (names are dropped after the decision)
  ai_checked_at   timestamptz,
  decision        text check (decision in ('approved','rejected')),
  decided_at      timestamptz,
  decided_by      text,
  note            text,                          -- shown to the poster when a proof is rejected
  file_deleted_at timestamptz
);
create index if not exists lease_checks_open on public.lease_checks (decision, created_at);
alter table public.lease_checks enable row level security;   -- no policies: read through the functions below

-- Real rents seen per building. Every checked lease adds one. Private.
create table if not exists public.building_prices (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  building_id int not null,                 -- id from data/listings.json
  beds        int,
  rent        int not null,                 -- per month
  per_person  boolean not null default true,
  lease_start date,
  lease_end   date,
  source      text not null,                -- 'lease' (read from a checked lease) or 'poster' (the poster's own number, on a checked listing)
  sublet_id   bigint references public.sublets(id) on delete set null
);
alter table public.building_prices enable row level security;   -- no policies: dashboard only

-- A new lease proof on a listing opens a check
create or replace function public.lease_check_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.has_lease_doc and new.lease_path is not null and (tg_op = 'INSERT' or not old.has_lease_doc) then
    insert into public.lease_checks (sublet_id, user_id, file_path) values (new.id, new.user_id, new.lease_path);
  end if;
  return new;
end $$;
drop trigger if exists lease_check_open on public.sublets;
create trigger lease_check_open after insert or update of has_lease_doc, lease_path on public.sublets
  for each row execute function public.lease_check_open();
-- proofs sent before lease checks existed
insert into public.lease_checks (sublet_id, user_id, file_path)
  select s.id, s.user_id, s.lease_path from public.sublets s
   where s.has_lease_doc and not s.lease_verified and s.lease_path is not null
     and not exists (select 1 from public.lease_checks c where c.sublet_id = s.id);

-- Approve or reject a proof. Returns the file to delete from storage (the caller deletes it, then calls lease_file_deleted).
create or replace function public.lease_decide(p_check bigint, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c public.lease_checks; s public.sublets; r numeric; pp boolean;
begin
  if not public.can_review() then raise exception 'Only Rhedr admins can do this'; end if;
  select * into c from public.lease_checks where id = p_check for update;
  if not found then raise exception 'That lease check no longer exists'; end if;
  if c.decision is not null then return c.file_path; end if;
  select * into s from public.sublets where id = c.sublet_id for update;
  update public.lease_checks
     set decision = case when p_approve then 'approved' else 'rejected' end, decided_at = now(),
         decided_by = coalesce(auth.jwt() ->> 'email', 'automatic'), note = nullif(trim(p_note), ''),
         extracted = extracted - 'tenant_names'
   where id = p_check;
  if p_approve then
    update public.sublets set lease_verified = true, lease_path = null,
           -- a listing that only waited for its lease check goes live
           status = case when status = 'review'
                          and not (flags && array['payment','offsite','story','deposit','reported']) then 'live' else status end
     where id = s.id;
    if s.building_id is not null then
      r := case when coalesce(c.extracted ->> 'monthly_rent', '') ~ '^[0-9]+(\.[0-9]+)?$' then (c.extracted ->> 'monthly_rent')::numeric end;
      pp := coalesce((c.extracted ->> 'rent_is_per_person')::boolean, true);
      if r between 50 and 20000 then
        insert into public.building_prices (building_id, beds, rent, per_person, lease_start, lease_end, source, sublet_id)
        values (s.building_id, s.beds, round(r), pp,
                case when coalesce(c.extracted ->> 'lease_start', '') ~ '^\d{4}-\d{2}-\d{2}$' then (c.extracted ->> 'lease_start')::date end,
                case when coalesce(c.extracted ->> 'lease_end', '') ~ '^\d{4}-\d{2}-\d{2}$' then (c.extracted ->> 'lease_end')::date end,
                'lease', s.id);
      elsif s.orig_price is not null then
        insert into public.building_prices (building_id, beds, rent, per_person, source, sublet_id)
        values (s.building_id, s.beds, s.orig_price, true, 'poster', s.id);
      end if;
    end if;
  else
    -- the poster can send a new proof from My sublets
    update public.sublets set has_lease_doc = false, lease_verified = false, lease_path = null where id = s.id;
  end if;
  return c.file_path;
end $$;

create or replace function public.lease_file_deleted(p_check bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_review() then raise exception 'Only Rhedr admins can do this'; end if;
  update public.lease_checks set file_path = null, file_deleted_at = now() where id = p_check;
end $$;

-- Files that should be deleted now: proofs already decided, and proofs nobody checked within 30 days (rejected first).
create or replace function public.lease_files_to_delete()
returns table (check_id bigint, file_path text)
language plpgsql security definer set search_path = public as $$
declare x record;
begin
  if not public.can_review() then raise exception 'Only Rhedr admins can do this'; end if;
  for x in select id from public.lease_checks where decision is null and created_at < now() - interval '30 days' loop
    perform public.lease_decide(x.id, false, 'We couldn''t check this proof in time. You can send it again.');
  end loop;
  return query select c.id, c.file_path from public.lease_checks c where c.decision is not null and c.file_path is not null;
end $$;

-- The review list for rhedr.com/admin
create or replace function public.lease_queue(p_done boolean default false)
returns table (check_id bigint, created_at timestamptz, result text, reasons text[], extracted jsonb, ai_checked_at timestamptz,
               decision text, decided_at timestamptz, note text, file_path text,
               sublet_id bigint, title text, kind text, space text, building_id int, building_name text, address text, unit text,
               beds int, price int, orig_price int, start_date date, end_date date, contact_name text, status text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can see this'; end if;
  return query
    select c.id, c.created_at, c.result, c.reasons, c.extracted, c.ai_checked_at, c.decision, c.decided_at, c.note, c.file_path,
           s.id, s.title, s.kind, s.space, s.building_id, s.building_name, s.address, s.unit, s.beds, s.price, s.orig_price,
           s.start_date, s.end_date, s.contact_name, s.status, u.email::text
      from public.lease_checks c join public.sublets s on s.id = c.sublet_id join auth.users u on u.id = c.user_id
     where (c.decision is null) <> p_done
     order by case when p_done then extract(epoch from c.decided_at) * -1 else extract(epoch from c.created_at) end
     limit 100;
end $$;

-- Change the switches from rhedr.com/admin
create or replace function public.set_lease_settings(p_required boolean, p_auto_green boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can do this'; end if;
  update public.site_settings set lease_proof_required = p_required, auto_approve_green = p_auto_green, updated_at = now() where id = 1;
end $$;

-- What the poster sees about their own proofs (only the outcome and the note, never the AI's reasons)
create or replace function public.my_lease_checks()
returns table (sublet_id bigint, decision text, note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (c.sublet_id) c.sublet_id, c.decision, c.note, c.created_at
    from public.lease_checks c where c.user_id = auth.uid()
   order by c.sublet_id, c.created_at desc $$;

revoke all on function public.lease_decide(bigint, boolean, text) from public, anon;
revoke all on function public.lease_file_deleted(bigint) from public, anon;
revoke all on function public.lease_files_to_delete() from public, anon;
revoke all on function public.lease_queue(boolean) from public, anon;
revoke all on function public.set_lease_settings(boolean, boolean) from public, anon;
revoke all on function public.my_lease_checks() from public, anon;
grant execute on function public.lease_decide(bigint, boolean, text) to authenticated, service_role;
grant execute on function public.lease_file_deleted(bigint) to authenticated, service_role;
grant execute on function public.lease_files_to_delete() to authenticated, service_role;
grant execute on function public.lease_queue(boolean) to authenticated;
grant execute on function public.set_lease_settings(boolean, boolean) to authenticated;
grant execute on function public.my_lease_checks() to authenticated;

-- Admins can open and delete lease proofs (the admin page shows each file through a link that works for 5 minutes)
drop policy if exists "lease proofs: admin read" on storage.objects;
create policy "lease proofs: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'lease-proofs' and public.is_admin());
drop policy if exists "lease proofs: admin delete" on storage.objects;
create policy "lease proofs: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lease-proofs' and public.is_admin());
