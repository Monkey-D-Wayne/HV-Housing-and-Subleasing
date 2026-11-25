-- Happy Valley Housing: sublets database.
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
create index if not exists sublets_live on public.sublets (status, end_date);

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

-- 4. Scam checks, run by the database on every new or edited listing -------
create or replace function public.sublet_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  txt text := lower(coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' ' || coalesce(new.roommates,''));
  f text[] := '{}';
  active int;
begin
  -- people outside Penn State can't post
  if not public.is_psu() then raise exception 'Sign in with a confirmed @psu.edu email to post'; end if;
  new.user_id := auth.uid();
  -- only an admin (in the dashboard) can set these
  if tg_op = 'INSERT' then new.lease_verified := false; new.created_at := now();
  else new.lease_verified := old.lease_verified; new.created_at := old.created_at; end if;

  if txt ~ '(western union|moneygram|wire (the|a|me)|wire transfer|gift ?card|bitcoin|crypto|usdt|cashier.?s check|money order)' then f := array_append(f, 'payment'); end if;
  if txt ~ '(whats ?app|telegram|signal app|text me at|kik)' then f := array_append(f, 'offsite'); end if;
  if txt ~ '(out of (the )?(country|state)|overseas|abroad|military deploy|missionary|god bless|can.?t show|no viewing|keys? (will be )?(mailed|shipped|sent))' then f := array_append(f, 'story'); end if;
  if txt ~ '(deposit|pay|payment).{0,40}(before|to hold|first|today)' then f := array_append(f, 'deposit'); end if;
  if new.orig_price is not null and new.price < new.orig_price * 0.35 then f := array_append(f, 'price'); end if;

  if tg_op = 'INSERT' then
    select count(*) into active from public.sublets s where s.user_id = auth.uid() and s.status in ('live','review') and s.end_date >= current_date;
    if active >= 3 then raise exception 'You already have 3 active sublets. Mark one as taken first.'; end if;
    if (select count(*) from public.sublets s where s.user_id = auth.uid() and s.created_at > now() - interval '1 day') >= 5 then
      raise exception 'Too many posts today. Try again tomorrow.'; end if;
  end if;

  if tg_op = 'UPDATE' and 'reported' = any(old.flags) then f := array_append(f, 'reported'); end if;
  new.flags := f;
  -- listings that trip a payment, off-site or story check wait for an admin
  if new.status = 'live' and (f && array['payment','offsite','story','deposit']) then new.status := 'review'; end if;
  if tg_op = 'UPDATE' and old.status in ('review','removed') and new.status = 'live' then new.status := old.status; end if;
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
   where status = 'live' and end_date >= current_date;
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
  with check (bucket_id in ('sublet-photos','lease-proofs') and (storage.foldername(name))[1] = auth.uid()::text and public.is_psu());
drop policy if exists "sublet photos: delete own" on storage.objects;
create policy "sublet photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id in ('sublet-photos','lease-proofs') and (storage.foldername(name))[1] = auth.uid()::text);
