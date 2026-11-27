-- Rhedr: messages between students (moat plan step 3).
-- Run setup.sql first (it already ran on the live site). Then paste this whole file into
-- Supabase, SQL Editor, New query, and press Run. Running it again is safe.
--
-- How it works
--   * A student taps "Message" on a sublet. That opens a chat with the poster. Nobody sees the other's email.
--   * Until BOTH students tap "We agreed on Rhedr", the database hides phone numbers, emails, links and
--     Venmo / Cash App / Instagram style handles in every message before it is saved.
--   * Once both agreed, each sees the other's psu.edu email in the chat. (Signing the sublease on Rhedr,
--     step 4, will replace this simple "both agreed" switch.)
--   * Only the two students in a chat can read it (row level security). Admins see a chat only when one
--     of the two reports it.
--   * The chat-emails Edge Function emails "You have a new message" through Resend (section F).

-- A. Tables -----------------------------------------------------------------------------------------
create table if not exists public.conversations (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  sublet_id          bigint references public.sublets(id) on delete set null,   -- the chat stays if the listing is deleted
  sublet_title       text not null,                                            -- copied in case the listing is deleted
  poster_id          uuid not null references auth.users(id) on delete cascade,
  student_id         uuid not null references auth.users(id) on delete cascade, -- the student who wrote first
  student_name       text check (char_length(student_name) between 1 and 40),
  poster_agreed_at   timestamptz,
  student_agreed_at  timestamptz,
  agreed_at          timestamptz,              -- both agreed: contact details are shared and messages aren't masked
  closed_at          timestamptz,
  closed_by          uuid,
  last_message_at    timestamptz not null default now(),
  poster_read_at     timestamptz,
  student_read_at    timestamptz,
  poster_emailed_at  timestamptz,              -- last "new message" email, so nobody gets one per message
  student_emailed_at timestamptz,
  unique (sublet_id, student_id),
  check (poster_id <> student_id)
);
create index if not exists conversations_poster on public.conversations (poster_id, last_message_at desc);
create index if not exists conversations_student on public.conversations (student_id, last_message_at desc);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_id       uuid references auth.users(id) on delete set null,   -- empty: a note from Rhedr ("Sam agreed on Rhedr")
  body            text not null check (char_length(body) between 1 and 2000),
  masked          boolean not null default false                       -- true: contact info was hidden in this message
);
create index if not exists messages_conv on public.messages (conversation_id, id);
create index if not exists messages_sender on public.messages (sender_id, created_at);

create table if not exists public.chat_reports (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason          text not null check (char_length(reason) between 3 and 500),
  resolved_at     timestamptz,
  unique (conversation_id, user_id)
);

-- B. Hide contact info -------------------------------------------------------------------------------
-- A speed bump, not a wall: someone can still spell a number out in a way this misses.
create or replace function public.mask_contact(t text) returns text
language plpgsql immutable as $$
declare h constant text := '[contact info hidden]';
begin
  if t is null then return null; end if;
  -- emails, also "name at gmail dot com"
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+\s*(@|\(at\)|\[at\]|\s+at\s+)\s*[A-Za-z0-9-]+(\s*(\.|\(dot\)|\[dot\]|\s+dot\s+)\s*[A-Za-z0-9-]+)*\s*(\.|\(dot\)|\[dot\]|\s+dot\s+)\s*(com|edu|net|org|io|me|co|us|info)\y', h, 'gi');
  -- links, except rhedr.com
  t := regexp_replace(t, 'https?://(?!(www\.)?rhedr\.com)[^\s]+', h, 'gi');
  t := regexp_replace(t, '\ywww\.(?!rhedr\.com)[^\s]+', h, 'gi');
  t := regexp_replace(t, '\y(?!rhedr\.)[A-Za-z0-9-]{2,}\.(com|net|org|me|io|ly|gg|app|link|co)(/[^\s]*)?\y', h, 'gi');
  -- phone numbers: 814-555-1234, (814) 555 1234, +1 814.555.1234, 8145551234, 555-1234
  t := regexp_replace(t, '(\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}', h, 'g');
  t := regexp_replace(t, '\y\d{3}[\s.-]\d{4}\y', h, 'g');
  -- a number spelled out or spaced out: "eight one four five five five ..." (7 or more digits in a row)
  t := regexp_replace(t, '(\y(zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)\y[\s,.-]+){6,}\y(zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)\y', h, 'gi');
  -- payment and social handles: "venmo @sam-l", "cash app $saml", "my insta is sam.l", "snapchat: saml"
  t := regexp_replace(t, '\y(venmo|cash\s?app|zelle|paypal|pay\s?pal|insta(gram)?|snapchat|whats\s?app|telegram|discord|kik|groupme|imessage|facebook|messenger|tiktok|twitter|ig|sc)\y[\s:=-]*((is|me|at|on|to)\y[\s:=-]*)*(@|\$)?[A-Za-z0-9._-]*[A-Za-z0-9_]', h, 'gi');
  t := regexp_replace(t, '\$[A-Za-z][A-Za-z0-9_]{2,}', h, 'g');                  -- $cashtag (not $650)
  t := regexp_replace(t, '(^|[^A-Za-z0-9._%+-])@[A-Za-z0-9._]{3,}', '\1' || h, 'g'); -- @handle
  -- several hidden bits in a row read better as one
  t := regexp_replace(t, '(\[contact info hidden\][\s,;:/-]*){2,}', h || ' ', 'g');
  return trim(t);
end $$;

-- C. Rules for every message -------------------------------------------------------------------------
-- Not "security definer" on purpose: current_user has to be the student (or the database, for notes from Rhedr).
create or replace function public.message_checks() returns trigger
language plpgsql set search_path = public as $$
declare c public.conversations; m text;
begin
  if current_user in ('authenticated','anon') then
    new.sender_id := auth.uid();
    if new.sender_id is null then raise exception 'Sign in to send messages'; end if;
  end if;
  new.created_at := now();
  new.masked := false;
  new.body := trim(coalesce(new.body, ''));
  if new.body = '' then raise exception 'Type a message first'; end if;
  select * into c from public.conversations where id = new.conversation_id;
  if not found then raise exception 'That chat no longer exists'; end if;
  if new.sender_id is null then return new; end if;   -- a note from Rhedr itself (only the database can write these)
  if new.sender_id not in (c.poster_id, c.student_id) then raise exception 'You''re not in this chat'; end if;
  if c.closed_at is not null then raise exception 'This chat is closed'; end if;
  if (select count(*) from public.messages x where x.sender_id = new.sender_id and x.created_at > now() - interval '1 minute') >= 15 then
    raise exception 'You''re sending messages very fast. Wait a minute and try again.'; end if;
  if (select count(*) from public.messages x where x.sender_id = new.sender_id and x.created_at > now() - interval '1 day') >= 400 then
    raise exception 'That''s the message limit for today. Try again tomorrow.'; end if;
  if c.agreed_at is null then
    m := public.mask_contact(new.body);
    if m is distinct from new.body then new.masked := true; new.body := coalesce(nullif(m, ''), '[contact info hidden]'); end if;
  end if;
  return new;
end $$;
drop trigger if exists message_checks on public.messages;
create trigger message_checks before insert on public.messages for each row execute function public.message_checks();

-- the chat moves to the top of both inboxes, and the sender has read everything up to their own message
create or replace function public.message_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations c set last_message_at = new.created_at,
         poster_read_at  = case when new.sender_id = c.poster_id  then new.created_at else c.poster_read_at end,
         student_read_at = case when new.sender_id = c.student_id then new.created_at else c.student_read_at end
   where c.id = new.conversation_id;
  return new;
end $$;
drop trigger if exists message_after on public.messages;
create trigger message_after after insert on public.messages for each row execute function public.message_after();

-- messages can't be edited or deleted from the site (they're the record of the deal)
create or replace function public.message_locked() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then raise exception 'Messages can''t be changed'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists message_locked on public.messages;
create trigger message_locked before update or delete on public.messages for each row execute function public.message_locked();

-- D. Who can read what ---------------------------------------------------------------------------------
create or replace function public.in_chat(p_conv bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c where c.id = p_conv and auth.uid() in (c.poster_id, c.student_id)) $$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.chat_reports enable row level security;   -- no policies: written through chat_report(), read on rhedr.com/admin

drop policy if exists "chats: the two students" on public.conversations;
create policy "chats: the two students" on public.conversations for select to authenticated
  using (auth.uid() in (poster_id, student_id));
drop policy if exists "messages: the two students read" on public.messages;
create policy "messages: the two students read" on public.messages for select to authenticated
  using (public.in_chat(conversation_id));
drop policy if exists "messages: the two students write" on public.messages;
create policy "messages: the two students write" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.in_chat(conversation_id));

revoke all on public.conversations, public.messages, public.chat_reports from anon, authenticated;
grant select on public.conversations to authenticated;          -- changes go through the functions below
grant select on public.messages to authenticated;
grant insert (conversation_id, body) on public.messages to authenticated;

-- E. What the Sublets page calls ------------------------------------------------------------------------
-- The old "Contact" button showed the poster's email to any signed-in student. Now it only shows the unit;
-- emails are shared in the chat once both students agree.
drop function if exists public.sublet_contact(bigint);
create or replace function public.sublet_contact(sid bigint)
returns table (contact_name text, unit text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_psu() and not public.is_admin() then raise exception 'Sign in with your Penn State email to see this'; end if;
  return query select s.contact_name, s.unit from public.sublets s where s.id = sid and s.status = 'live';
end $$;
revoke all on function public.sublet_contact(bigint) from public, anon;
grant execute on function public.sublet_contact(bigint) to authenticated;

-- Start a chat about a sublet (or add to the one you already have). Returns the chat's id.
create or replace function public.start_chat(p_sublet bigint, p_body text, p_name text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare s public.sublets; cid bigint; me uuid := auth.uid(); nm text := nullif(trim(p_name), '');
begin
  if me is null or (not public.is_psu() and not public.is_admin()) then
    raise exception 'Sign in with your Penn State email to message the poster'; end if;
  select id into cid from public.conversations where sublet_id = p_sublet and student_id = me;
  if cid is null then
    select * into s from public.sublets where id = p_sublet and status = 'live' and end_date >= public.local_today();
    if not found then raise exception 'This sublet is no longer listed'; end if;
    if s.user_id = me then raise exception 'This is your own sublet'; end if;
    if (select count(*) from public.conversations c where c.student_id = me and c.created_at > now() - interval '1 day') >= 15 then
      raise exception 'You''ve started a lot of chats today. Try again tomorrow.'; end if;
    insert into public.conversations (sublet_id, sublet_title, poster_id, student_id, student_name)
    values (s.id, s.title, s.user_id, me, left(nm, 40)) returning id into cid;
  elsif nm is not null then
    update public.conversations set student_name = left(nm, 40) where id = cid;
  end if;
  if nullif(trim(p_body), '') is not null then
    insert into public.messages (conversation_id, sender_id, body) values (cid, me, p_body);
  end if;
  return cid;
end $$;

-- Your chats, newest first, with what the inbox needs
create or replace function public.my_chats()
returns table (id bigint, sublet_id bigint, sublet_title text, photo text, price int, building_name text, address text,
               i_am text, other_name text, last_body text, last_from_me boolean, last_at timestamptz, unread int,
               i_agreed boolean, they_agreed boolean, agreed_at timestamptz, closed_at timestamptz, listed boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.sublet_id, coalesce(s.title, c.sublet_title), s.photos[1], s.price, s.building_name, s.address,
         case when c.poster_id = auth.uid() then 'poster' else 'student' end,
         case when c.poster_id = auth.uid() then coalesce(c.student_name, 'A Penn State student')
              else coalesce(nullif(trim(s.contact_name), ''), 'The poster') end,
         lm.body, lm.sender_id = auth.uid(), c.last_message_at,
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id and x.sender_id is distinct from auth.uid()
             and x.created_at > coalesce(case when c.poster_id = auth.uid() then c.poster_read_at else c.student_read_at end, '-infinity')),
         case when c.poster_id = auth.uid() then c.poster_agreed_at else c.student_agreed_at end is not null,
         case when c.poster_id = auth.uid() then c.student_agreed_at else c.poster_agreed_at end is not null,
         c.agreed_at, c.closed_at,
         coalesce(s.status = 'live' and s.end_date >= public.local_today(), false)
    from public.conversations c
    left join public.sublets s on s.id = c.sublet_id
    left join lateral (select m.body, m.sender_id from public.messages m where m.conversation_id = c.id order by m.id desc limit 1) lm on true
   where auth.uid() in (c.poster_id, c.student_id)
   order by c.last_message_at desc
   limit 200 $$;

-- You've read the chat up to now
create or replace function public.chat_read(p_conv bigint) returns void
language sql security definer set search_path = public as $$
  update public.conversations c
     set poster_read_at  = case when c.poster_id  = auth.uid() then now() else c.poster_read_at end,
         student_read_at = case when c.student_id = auth.uid() then now() else c.student_read_at end
   where c.id = p_conv and auth.uid() in (c.poster_id, c.student_id) $$;
revoke all on function public.chat_read(bigint) from public, anon;

-- "We agreed on Rhedr". When both have tapped it, contact details are shared. Either side can take it back
-- until the other one also taps it; after that it stays (step 4, signing, builds on it).
create or replace function public.agree_deal(p_conv bigint, p_agree boolean default true)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare c public.conversations; me uuid := auth.uid(); poster boolean; nm text;
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found or me not in (c.poster_id, c.student_id) then raise exception 'That chat no longer exists'; end if;
  if c.agreed_at is not null then return c.agreed_at; end if;
  if c.closed_at is not null then raise exception 'This chat is closed'; end if;
  poster := me = c.poster_id;
  nm := case when poster then coalesce((select nullif(trim(s.contact_name), '') from public.sublets s where s.id = c.sublet_id), 'The poster')
             else coalesce(c.student_name, 'The student') end;
  if poster then
    if p_agree = (c.poster_agreed_at is not null) then return null; end if;
    update public.conversations set poster_agreed_at = case when p_agree then now() end where id = p_conv returning * into c;
  else
    if p_agree = (c.student_agreed_at is not null) then return null; end if;
    update public.conversations set student_agreed_at = case when p_agree then now() end where id = p_conv returning * into c;
  end if;
  if c.poster_agreed_at is not null and c.student_agreed_at is not null then
    update public.conversations set agreed_at = now() where id = p_conv returning * into c;
    insert into public.messages (conversation_id, sender_id, body) values (p_conv, null,
      'You both agreed on Rhedr. Your psu.edu emails are now shown at the top of this chat. Next: ask the landlord for their sublease form, and see the place before you pay.');
  elsif p_agree then
    insert into public.messages (conversation_id, sender_id, body) values (p_conv, null,
      nm || ' tapped "We agreed on Rhedr". Once you tap it too, you''ll both see each other''s email.');
  else
    insert into public.messages (conversation_id, sender_id, body) values (p_conv, null, nm || ' took back "We agreed on Rhedr".');
  end if;
  perform public.chat_read(p_conv);   -- the note is news for the other student, not for you
  return c.agreed_at;
end $$;

-- The other student's details, only after you both agreed
create or replace function public.chat_contact(p_conv bigint)
returns table (name text, email text, unit text, address text)
language plpgsql stable security definer set search_path = public as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv;
  if not found or auth.uid() not in (c.poster_id, c.student_id) then raise exception 'That chat no longer exists'; end if;
  if c.agreed_at is null then raise exception 'Contact details are shared once you both agree on Rhedr'; end if;
  return query
    select case when c.poster_id = auth.uid() then coalesce(c.student_name, 'The student') else coalesce(nullif(trim(s.contact_name), ''), 'The poster') end,
           u.email::text, s.unit, s.address
      from auth.users u left join public.sublets s on s.id = c.sublet_id
     where u.id = case when c.poster_id = auth.uid() then c.student_id else c.poster_id end;
end $$;

-- Close a chat (no more messages from either side)
create or replace function public.chat_close(p_conv bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv for update;
  if not found or auth.uid() not in (c.poster_id, c.student_id) then raise exception 'That chat no longer exists'; end if;
  if c.closed_at is not null then return; end if;
  update public.conversations set closed_at = now(), closed_by = auth.uid() where id = p_conv;
  insert into public.messages (conversation_id, sender_id, body) values (p_conv, null, 'This chat was closed. Neither of you can send more messages here.');
  perform public.chat_read(p_conv);
end $$;

-- Report a chat (scam, harassment). Rhedr admins can then read that chat on rhedr.com/admin.
create or replace function public.chat_report(p_conv bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.in_chat(p_conv) then raise exception 'That chat no longer exists'; end if;
  insert into public.chat_reports (conversation_id, user_id, reason) values (p_conv, auth.uid(), left(trim(p_reason), 500))
  on conflict (conversation_id, user_id) do update set reason = excluded.reason, created_at = now(), resolved_at = null;
end $$;

-- For rhedr.com/admin: reported chats, with their messages
create or replace function public.chat_report_queue(p_done boolean default false)
returns table (report_id bigint, created_at timestamptz, reason text, reporter text, resolved_at timestamptz,
               conversation_id bigint, sublet_id bigint, sublet_title text, poster text, student text,
               agreed_at timestamptz, closed_at timestamptz, messages jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can see this'; end if;
  return query
    select r.id, r.created_at, r.reason, ru.email::text, r.resolved_at, c.id, c.sublet_id, c.sublet_title,
           pu.email::text, su.email::text, c.agreed_at, c.closed_at,
           (select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'masked', m.masked, 'body', m.body,
                    'from', case when m.sender_id is null then 'Rhedr' when m.sender_id = c.poster_id then 'Poster' else 'Student' end) order by m.id), '[]')
              from public.messages m where m.conversation_id = c.id)
      from public.chat_reports r join public.conversations c on c.id = r.conversation_id
      left join auth.users ru on ru.id = r.user_id left join auth.users pu on pu.id = c.poster_id left join auth.users su on su.id = c.student_id
     where (r.resolved_at is null) <> p_done
     order by r.created_at desc limit 100;
end $$;
create or replace function public.chat_report_resolve(p_report bigint, p_close boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can do this'; end if;
  update public.chat_reports set resolved_at = now() where id = p_report returning conversation_id into cid;
  if p_close and cid is not null then
    update public.conversations set closed_at = coalesce(closed_at, now()) where id = cid;
    insert into public.messages (conversation_id, sender_id, body) values (cid, null, 'Rhedr closed this chat after a report.');
  end if;
end $$;

revoke all on function public.start_chat(bigint, text, text) from public, anon;
revoke all on function public.my_chats() from public, anon;
revoke all on function public.chat_read(bigint) from public, anon;
revoke all on function public.agree_deal(bigint, boolean) from public, anon;
revoke all on function public.chat_contact(bigint) from public, anon;
revoke all on function public.chat_close(bigint) from public, anon;
revoke all on function public.chat_report(bigint, text) from public, anon;
revoke all on function public.chat_report_queue(boolean) from public, anon;
revoke all on function public.chat_report_resolve(bigint, boolean) from public, anon;
revoke all on function public.in_chat(bigint) from public, anon;
grant execute on function public.start_chat(bigint, text, text), public.my_chats(), public.chat_read(bigint),
  public.agree_deal(bigint, boolean), public.chat_contact(bigint), public.chat_close(bigint), public.chat_report(bigint, text),
  public.chat_report_queue(boolean), public.chat_report_resolve(bigint, boolean), public.in_chat(bigint), public.mask_contact(text)
  to authenticated;

-- Phone numbers and emails in a listing would skip the chat, so the listing's text gets the same treatment.
-- (Triggers run in name order, so the scam checks in setup.sql still see the original wording first.)
create or replace function public.sublet_mask() returns trigger
language plpgsql as $$
begin
  new.description := public.mask_contact(new.description);
  new.roommates := public.mask_contact(new.roommates);
  return new;
end $$;
drop trigger if exists zy_sublet_mask on public.sublets;
create trigger zy_sublet_mask before insert or update of description, roommates on public.sublets
  for each row when (current_user in ('authenticated','anon')) execute function public.sublet_mask();

-- Live updates in the open chat (Supabase Realtime). Row level security still applies.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
      alter publication supabase_realtime add table public.conversations; end if;
  end if;
end $$;

-- F. "You have a new message" emails ------------------------------------------------------------------
-- Every 5 minutes the chat-emails Edge Function asks for students with unread messages that are at least
-- 2 minutes old (so someone who's in the chat right now doesn't get an email), at most one email per chat
-- every 30 minutes.
create or replace function public.chat_emails_due()
returns table (conversation_id bigint, side text, email text, to_name text, from_name text, sublet_title text,
               unread int, last_body text, agreed boolean)
language sql stable security definer set search_path = public as $$
  with sides as (
    select c.*, 'poster'::text as side, c.poster_id as to_id, c.poster_read_at as read_at, c.poster_emailed_at as emailed_at
      from public.conversations c
    union all
    select c.*, 'student', c.student_id, c.student_read_at, c.student_emailed_at from public.conversations c
  )
  select x.id, x.side, u.email::text,
         case when x.side = 'poster' then coalesce(nullif(trim(s.contact_name), ''), 'there') else coalesce(x.student_name, 'there') end,
         case when x.side = 'poster' then coalesce(x.student_name, 'A Penn State student') else coalesce(nullif(trim(s.contact_name), ''), 'The poster') end,
         coalesce(s.title, x.sublet_title), n.unread, n.last_body, x.agreed_at is not null
    from sides x
    join auth.users u on u.id = x.to_id and u.email_confirmed_at is not null
    left join public.sublets s on s.id = x.sublet_id
    cross join lateral (
      select count(*)::int as unread, (array_agg(m.body order by m.id desc))[1] as last_body, max(m.created_at) as newest
        from public.messages m
       where m.conversation_id = x.id and m.sender_id is distinct from x.to_id
         and m.created_at > coalesce(x.read_at, '-infinity') and m.created_at > coalesce(x.emailed_at, '-infinity')) n
   where n.unread > 0
     and n.newest < now() - interval '2 minutes'
     and (x.emailed_at is null or x.emailed_at < now() - interval '30 minutes')
     and (x.closed_at is null or x.closed_at > coalesce(x.emailed_at, '-infinity'))
   order by u.email, x.last_message_at desc
   limit 300 $$;
revoke all on function public.chat_emails_due() from public, anon, authenticated;
grant execute on function public.chat_emails_due() to service_role;

-- Message stats for rhedr.com/admin
create or replace function public.chat_stats()
returns table (chats bigint, chats_7d bigint, messages_7d bigint, agreed bigint, masked_7d bigint, open_reports bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can see this'; end if;
  return query select (select count(*) from public.conversations),
                      (select count(*) from public.conversations where created_at > now() - interval '7 days'),
                      (select count(*) from public.messages where created_at > now() - interval '7 days' and sender_id is not null),
                      (select count(*) from public.conversations where agreed_at is not null),
                      (select count(*) from public.messages where created_at > now() - interval '7 days' and masked),
                      (select count(*) from public.chat_reports where resolved_at is null);
end $$;
revoke all on function public.chat_stats() from public, anon;
grant execute on function public.chat_stats() to authenticated;

-- The Edge Functions sign in as service_role, which needs table access spelled out in this project
grant usage on schema public to service_role;
grant select, insert, update, delete on public.conversations, public.messages, public.chat_reports to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Run chat-emails every 5 minutes (uses the same key as send-alerts, from table alert_job)
select cron.unschedule(jobid) from cron.job where jobname = 'chat-emails';
select cron.schedule('chat-emails', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://jszujotoetfhywyshxjq.supabase.co/functions/v1/chat-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-rhedr-job', (select secret from public.alert_job where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
