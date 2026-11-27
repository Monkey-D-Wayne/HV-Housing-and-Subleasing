-- Rhedr: messages between students (moat plan step 3).
-- Run setup.sql first (it already ran on the live site). Then paste this whole file into
-- Supabase, SQL Editor, New query, and press Run. Running it again is safe.
--
-- How it works
--   * A student taps "Message" on a sublet. That opens a chat with the poster. Nobody sees the other's email.
--   * Until BOTH students tap "We agreed on Rhedr", the database hides phone numbers, emails, links and
--     Venmo / Cash App / Instagram style handles in every message before it is saved, also when they're
--     disguised or split over several messages (section B and C), with a quick AI check on suspicious ones.
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
-- A speed bump, not a wall. Every message from a student is checked in four ways before it's saved:
--   1. contact_norm: undo lookalike tricks (Cyrillic or Greek letters, fancy or fullwidth letters, emoji letters
--      and digits like 8️⃣ or 🅶, accents, invisible characters).
--   2. mask_contact: the rules below hide just the contact part (emails, phones, links, handles).
--   3. contact_found: a second reading that catches what hides between the rules: numbers spelled out or mixed
--      ("eight 1 four", "8l4"), leetspeak ("gm4il", "v3nm0"), spaced or split words ("g m a i l", "insta gram",
--      "p s u . e d u"), "(at)" and "(dot)" in brackets. If it finds something, the whole message is hidden.
--   4. mask_split_contact: the sender's last few messages read together (contact info sent a piece at a time).
-- Suspicious messages that pass all four also get a quick AI check (section C2).
-- sublets.js has a copy of 1 to 3 (for the warning while typing and demo mode). Keep the two the same.

create or replace function public.contact_norm(t text) returns text
language plpgsql immutable as $$
begin
  if t is null then return null; end if;
  -- invisible characters, emoji variation marks, the keycap mark (8️⃣ is "8" plus two of these) and accents (gmàil),
  -- after taking fancy letters and digits apart (𝐛𝐨𝐚𝐳, ｂｏａｚ, ①, ⁸)
  t := normalize(t, NFKD);
  t := regexp_replace(t, '[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\u20E3\u0300-\u036F]', '', 'g');
  t := normalize(t, NFKC);
  -- letters from other alphabets that look Latin, emoji letters and digits, dots that look like dots
  t := translate(t,
    'аеорсхуікмтнвѕјԁӏɡАЕОРСХУІКМТНВЅЈαοιρνκτυχεΑΒΕΖΗΙΚΜΝΟΡΤΥΧıȷɑøØ🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉🇦🇧🇨🇩🇪🇫🇬🇭🇮🇯🇰🇱🇲🇳🇴🇵🇶🇷🇸🇹🇺🇻🇼🇽🇾🇿❶❷❸❹❺❻❼❽❾➀➁➂➃➄➅➆➇➈➊➋➌➍➎➏➐➑➒⓵⓶⓷⓸⓹⓺⓻⓼⓽⓿·•∙⋅。｡',
    'aeopcxyikmthbsjdlgAEOPCXYIKMTHBSJaoipvktuxeABEZHIKMNOPTYXijaooABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567891234567891234567891234567890......');
  return t;
end $$;

-- Words that come after "venmo", "insta", "username" and so on but aren't a handle ("venmo is fine", "ig that works")
-- (kept in the rules below as (?!(or|and|...)\y))

create or replace function public.mask_contact(t text) returns text
language plpgsql immutable as $$
declare h constant text := '[contact info hidden]';
        sw constant text := '(?!(or|and|on|at|to|ok|okay|works?|fine|good|great|too|for|if|but|then|please|pls|only|instead|so|the|a|an|it|its|that|this|these|you|u|we|i|me|my|your|ur|account|app|request|payment|pay|here|there|rhedr|later|now|with|is|are|not|no|yes|either|both|also|right|thing|stuff|etc|maybe|work|accepted|is|was|will|would|could|can|do|does|did|have|has|in|of|or|not|anyone|everyone|someone|him|her|them|us|still|already|just|more|active|never|rarely|also)\y)';
begin
  if t is null then return null; end if;
  -- emails, also "name at gmail dot com"
  t := regexp_replace(t, '([A-Za-z0-9_%+-]+\s*(\(dot\)|\[dot\]|\{dot\}|<dot>|\ydot\y|\s\.\s)\s*)*[A-Za-z0-9._%+-]+\s*(@|\(at\)|\[at\]|\{at\}|<at>|\s+at\s+)\s*[A-Za-z0-9-]+(\s*(\.|\(dot\)|\[dot\]|\{dot\}|<dot>|\s+dot\s+)\s*[A-Za-z0-9-]+)*\s*(\.|\(dot\)|\[dot\]|\{dot\}|<dot>|\s+dot\s+)\s*(com|edu|net|org|io|me|co|us|info)\y', h, 'gi');
  -- emails written with spaces or words: "boaz psu .edu", "abc123 at psu dot edu", "name (at) psu"
  t := regexp_replace(t, '(([A-Za-z0-9_%+-]+\s*(\(dot\)|\[dot\]|\{dot\}|<dot>|\ydot\y|\s\.\s|\.)\s*)*[A-Za-z0-9._%+-]{2,})\s*(@|\(at\)|\[at\]|\{at\}|<at>|\yat\s+(sign|symbol)\y|\yat\y)?\s*psu\s*(\.|\(dot\)|\[dot\]|\{dot\}|<dot>|\ydot\y)?\s*edu\y', h, 'gi');
  t := regexp_replace(t, '[A-Za-z0-9._%+-]{2,}\s*(@|\(at\)|\[at\]|\{at\}|<at>)\s*psu\y', h, 'gi');
  -- "name gmail", "name at outlook dot com" and other webmail
  t := regexp_replace(t, '(([A-Za-z0-9_%+-]+\s*(\(dot\)|\[dot\]|\{dot\}|<dot>|\ydot\y|\s\.\s|\.)\s*)*[A-Za-z0-9._%+-]{2,})\s*(@|\(at\)|\[at\]|\{at\}|<at>|\yat\s+(sign|symbol)\y|\yat\y)?\s*(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|protonmail|proton\.me)\y(\s*(\.|\(dot\)|\[dot\]|\{dot\}|<dot>|\ydot\y)?\s*(com|net)\y)?', h, 'gi');
  -- "site dot com", "site . com"
  t := regexp_replace(t, '\y(?!rhedr\y)[A-Za-z0-9-]{2,}(\s*(\(dot\)|\[dot\]|\{dot\}|<dot>|\ydot\y)\s*|\s+\.\s*|\.\s+)(com|net|org|edu)\y', h, 'gi');
  -- links, except rhedr.com
  t := regexp_replace(t, 'https?://(?!(www\.)?rhedr\.com)[^\s]+', h, 'gi');
  t := regexp_replace(t, '\ywww\.(?!rhedr\.com)[^\s]+', h, 'gi');
  t := regexp_replace(t, '\y(?!rhedr\.)[A-Za-z0-9-]{2,}\.(com|net|org|me|io|ly|gg|app|link|co|us|info|xyz|page|bio|tv|ee|ai|gl|cc)(/[^\s]*)?\y', h, 'gi');
  -- phone numbers: 814-555-1234, (814) 555 1234, +1 814.555.1234, 8145551234, 555-1234
  t := regexp_replace(t, '(\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}', h, 'g');
  t := regexp_replace(t, '\y(?!\d\d[05]-\d\d[05]0\y)\d{3}[\s.-]\d{4}\y', h, 'g');   -- (not a price range like 950-1000)
  -- Penn State access IDs on their own: abc1234, xy12 (2-3 letters and 1-4 digits)
  t := regexp_replace(t, '\y(?!(mp3|mp4|ps2|ps3|ps4|ps5)\y)[A-Za-z]{2,3}\d{1,4}\y', h, 'gi');
  -- a number spelled out or spaced out: "eight one four five five five ..." (7 or more digits in a row)
  t := regexp_replace(t, '(\y(zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)\y[\s,.-]+){6,}\y(zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)\y', h, 'gi');
  -- payment and social handles: "venmo @sam-l", "cash app $saml", "my insta is sam.l", "snapchat: saml", "my name on ig is sam"
  t := regexp_replace(t, '\y(venmo|cash\s?app|zelle|paypal|pay\s?pal|apple\s?pay|insta(\s?gram)?|the\s+gram|gram|snap\s?chat|whats\s?app|telegram|discord|kik|group\s?me|imessage|face\s?book|fb|messenger|tik\s?tok|twitter|threads|linked\s?in|signal\s+app|wechat|reddit|bereal|ig|sc)\y[\s:=-]*((is|me|at|on|to|name|user\s?name|handle|id|account|@)\y[\s:=-]*)*' || sw || '(@|\$)?[A-Za-z0-9._#-]*[A-Za-z0-9_]', h, 'gi');
  -- "sam_lee on insta", "saml on snap"
  t := regexp_replace(t, '(?<![A-Za-z0-9._@$-])' || sw || '[@$]?[A-Za-z0-9._-]*[A-Za-z0-9_]{3,}\s+(on|at|via)\s+(venmo|cash\s?app|zelle|paypal|insta(\s?gram)?|the\s+gram|gram|ig|snap(\s?chat)?|sc|whats\s?app|telegram|discord|group\s?me|face\s?book|fb|tik\s?tok|twitter|linked\s?in)\y', h, 'gi');
  -- "snap: name", "snap is name", "my snap name is name"
  t := regexp_replace(t, '\ysnap\s*(:|@|\yis\y|\yname\y|\yuser\s?name\y|\yhandle\y)[\s:@]*((is|name)\y[\s:@]*)*' || sw || '[A-Za-z0-9._-]*[A-Za-z0-9_]', h, 'gi');
  -- "my username is sam.lee", "handle: saml"
  t := regexp_replace(t, '\y(user\s?name|handle|screen\s?name|gamertag)\y[\s:=-]*((is|on|at|it''?s)\y[\s:=-]*)*' || sw || '@?[A-Za-z0-9._-]*[A-Za-z0-9_]', h, 'gi');
  t := regexp_replace(t, '\$[A-Za-z][A-Za-z0-9_]{2,}', h, 'g');                  -- $cashtag (not $650)
  t := regexp_replace(t, '(^|[^A-Za-z0-9._%+-])@[A-Za-z0-9._]{3,}', '\1' || h, 'g'); -- @handle
  -- several hidden bits in a row read better as one
  t := regexp_replace(t, '(\[contact info hidden\][\s,;:/-]*){2,}', h || ' ', 'g');
  return trim(t);
end $$;

-- Counts digits that sit together, also spelled out ("eight one four"), mixed ("8 one 4"), leet ("8l4") or with
-- dots, dashes, stars or spaces between them. A phone number is there if a run has 10+ digits, or 7 to 9 digits
-- that aren't just two numbers like "1200-1350" or "2026-2027". Dates like 8-15-2026 and times like 10:30 don't count.
-- strict (for messages read together): only a run of exactly 10 digits, or 11 starting with 1.
create or replace function public.contact_digits(t text, strict boolean default false) returns boolean
language plpgsql immutable as $$
declare v text := lower(coalesce(t, '')); r text; dg text; nd int; ng int; i int;
        w text[] := array['zero','0','oh','0','o','0','one','1','won','1','two','2','three','3','four','4','five','5','six','6',
                          'seven','7','eight','8','nine','9','niner','9','ten','10','eleven','11','twelve','12','thirteen','13',
                          'fourteen','14','fifteen','15','sixteen','16','seventeen','17','eighteen','18','nineteen','19',
                          'twenty','20','thirty','30','forty','40','fourty','40','fifty','50','sixty','60','seventy','70',
                          'eighty','80','ninety','90','hundred','00'];
begin
  if position(',' in v) > 0 then v := regexp_replace(v, '(\d),(\d{3})(?!\d)', '\1\2', 'g'); end if;   -- 1,200 is one number
  for i in 1 .. array_length(w, 1) by 2 loop
    continue when position(w[i] in v) = 0;
    v := regexp_replace(v, '(?<![a-z])' || w[i] || '(?![a-z])', w[i + 1], 'g');
  end loop;
  if translate(v, '0123456789', '') = v then return false; end if;   -- no digits at all
  if position('double' in v) > 0 or position('dbl' in v) > 0 then
    v := regexp_replace(v, '(?<![a-z])(double|dbl)[\s-]*(\d)', '\2\2', 'g'); end if;  -- "double five"
  if position('triple' in v) > 0 then v := regexp_replace(v, '(?<![a-z])triple[\s-]*(\d)', '\1\1\1', 'g'); end if;
  for i in 1 .. 3 loop                                                       -- 8l4, 1oo, 5O5, 8I4
    exit when v !~ '\d[oli|!]|[oli|!]\d';
    v := regexp_replace(v, '(?<=\d)o|o(?=\d)', '0', 'g');
    v := regexp_replace(v, '(?<=\d)[li|!]|[li|!](?=\d)', '1', 'g');
  end loop;
  for r in select m[1] from regexp_matches(v, '(\d(?:[\s.,_*~|()+#=-]*\d)*)', 'g') m loop
    if r ~ '^(\d{1,2}[.-]\d{1,2}[.-](\d{2}|\d{4})|\d{4}[.-]\d{1,2}[.-]\d{1,2})$' then continue; end if;
    dg := ''; ng := 0;
    for i in 1 .. char_length(r) loop                                       -- the digits, and how many groups of them
      if strpos('0123456789', substr(r, i, 1)) > 0 then
        if i = 1 or strpos('0123456789', substr(r, i - 1, 1)) = 0 then ng := ng + 1; end if;
        dg := dg || substr(r, i, 1);
      end if;
    end loop;
    nd := char_length(dg);
    if strict then
      if nd = 10 or (nd = 11 and dg like '1%') then return true; end if;
    elsif nd >= 10 or (nd >= 7 and ng <> 2) then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- The text with spelling tricks undone, to run mask_contact on again: lower case, leetspeak inside words,
-- words spaced or split ("g m a i l", "gm ail", "insta gram", "ven mo"), "gee mail", "pee ess you", "(at)", "(dot)",
-- and runs of single letters glued back together ("b o a z @ p s u . e d u").
drop function if exists public.contact_deob(text);
create or replace function public.contact_deob(t text, one_is_l boolean default false) returns text
language plpgsql immutable as $$
declare v text := lower(coalesce(t, '')); k text; m text; w text; nw text; c text; i int; j int; sq text;
        kw text[] := array['googlemail','protonmail','snapchat','instagram','whatsapp','telegram','cashapp','facebook','linkedin',
                           'imessage','hotmail','outlook','discord','groupme','twitter','paypal','icloud','tiktok','gmail','yahoo',
                           'venmo','zelle','insta','snap','psu','edu','com'];
begin
  -- leetspeak inside words of 4+ characters with 2+ letters: gm4il, v3nm0, 1nstagram, zel1e (not 4b, 3rd, 2nd)
  for m in select x[1] from regexp_matches(v, '([a-z0-9@!|$]{4,})', 'g') x loop
    continue when char_length(m) - char_length(translate(m, 'abcdefghijklmnopqrstuvwxyz', '')) < 2
               or translate(m, '013457@!|$', '') = m;
    w := m;
    for i in 1 .. 2 loop
      nw := '';
      for j in 1 .. char_length(w) loop
        c := substr(w, j, 1);
        if strpos('013457@!|$', c) > 0
           and ((j > 1 and strpos('abcdefghijklmnopqrstuvwxyz', substr(w, j - 1, 1)) > 0)
             or (j < char_length(w) and strpos('abcdefghijklmnopqrstuvwxyz', substr(w, j + 1, 1)) > 0)) then
          c := translate(c, '013457@!|$', case when one_is_l then 'oleastails' else 'oieastails' end);
        end if;
        nw := nw || c;
      end loop;
      w := nw;
    end loop;
    v := replace(v, m, w);
  end loop;
  -- written out: "gee mail", "pee ess you", "ee dee you", "see oh em"
  if v ~ '(?<![a-z])(g|gee|jee|ge|pee|p|ee|e|see|c)[\s.,_*~-]' then
    v := regexp_replace(v, '(?<![a-z])(g|gee|jee|ge)[\s._*~-]*mail(?![a-z])', 'gmail', 'g');
    v := regexp_replace(v, '(?<![a-z])(pee|p)[\s.,_*~-]*(ess|s)[\s.,_*~-]*(you|u)(?![a-z])', 'psu', 'g');
    v := regexp_replace(v, '(?<![a-z])(ee|e)[\s.,_*~-]*(dee|d)[\s.,_*~-]*(you|u)(?![a-z])', 'edu', 'g');
    v := regexp_replace(v, '(?<![a-z])(see|c)[\s.,_*~-]*(oh|o)[\s.,_*~-]*(em|m)(?![a-z])', 'com', 'g');
  end if;
  -- spaced or split: "g m a i l", "gm-ail", "insta gram"
  sq := translate(v, ' ._*~|,/-' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13), '');
  foreach k in array kw loop
    continue when position(k in sq) = 0;
    v := regexp_replace(v, '(?<![a-z])' || array_to_string(string_to_array(k, null), '[\s._*~|,/-]*') || '(?![a-z])', k, 'g');
  end loop;
  -- "(at)", "at sign", "(dot)", "dot com", " . edu"
  if v ~ '[(\[{<@]|(?<![a-z])at\s+(sign|symbol)|(dot|dawt|dott|period|punto|\.)\s*(com|edu|net|org|io|me|co|us)(?![a-z])' then
    v := regexp_replace(v, '\s*([(\[{<]\s*(at|a)\s*[)\]}>]|(?<![a-z])at\s+(sign|symbol)(?![a-z])|@\s*(sign|symbol)(?![a-z]))\s*', '@', 'g');
    v := regexp_replace(v, '(?<=[a-z0-9])\s*@\s*(?=[a-z])', '@', 'g');
    v := regexp_replace(v, '\s*([(\[{<]\s*(dot|d0t|\.)\s*[)\]}>]|(?<![a-z])(dot|dawt|dott|period|punto)(?=\s*(com|edu|net|org|io|me|co|us)(?![a-z])))\s*', '.', 'g');
    v := regexp_replace(v, '\s*\.\s*(?=(com|edu|net|org|io|me|co|us)(?![a-z]))', '.', 'g');
  end if;
  -- single letters in a row, glued: "b o a z" -> "boaz"
  for m in select x[1] from regexp_matches(v, '((?<![a-z0-9])[a-z0-9@.](?![a-z0-9])(?:[\s_*~|,/+-]+[a-z0-9@.](?![a-z0-9])){3,})', 'g') x loop
    v := replace(v, m, regexp_replace(m, '[\s_*~|,/+-]+', '', 'g'));
  end loop;
  return v;
end $$;

-- true when the text still holds contact info once the tricks are undone (t should already be contact_norm'ed)
create or replace function public.contact_found(t text, strict boolean default false) returns boolean
language plpgsql immutable as $$
declare d text;
begin
  if t is null or t = '' then return false; end if;
  if public.contact_digits(t, strict) then return true; end if;
  d := public.contact_deob(t);
  -- nothing to undo: the rules already had their say on this text (they don't care about upper or lower case)
  if d <> lower(t) and public.mask_contact(d) is distinct from trim(d) then return true; end if;
  if position('1' in t) = 0 then return false; end if;
  d := public.contact_deob(t, true);                              -- "zel1e": a 1 can stand for l as well as i
  return d <> lower(t) and public.mask_contact(d) is distinct from trim(d);
end $$;

-- What a listing shows: only the contact parts are hidden
create or replace function public.mask_text(t text) returns text
language plpgsql immutable as $$
declare n text; m text;
begin
  if t is null then return null; end if;
  n := public.contact_norm(t);
  m := public.mask_contact(n);
  return case when m is distinct from trim(n) then m else t end;
end $$;

-- What a chat message shows: the contact parts hidden, or the whole message if the tricks can't be pinned down
create or replace function public.mask_message(t text) returns text
language plpgsql immutable as $$
declare n text; m text;
begin
  if t is null then return null; end if;
  n := public.contact_norm(t);
  m := public.mask_contact(n);
  if m is distinct from trim(n) then return coalesce(nullif(m, ''), '[contact info hidden]'); end if;
  if public.contact_found(n) then return '[contact info hidden]'; end if;
  return t;
end $$;

-- A message that's just one word that could be a username ("boazwc", "sam.lee"), not "ok" or "thanks"
create or replace function public.contact_lone_word(t text) returns boolean
language sql immutable as $f$
  select lower(coalesce(t, '')) ~ '^\s*[a-z][a-z0-9._-]{2,19}[\s.!?]*$'
         and lower(coalesce(t, '')) !~ '^\s*(ok|okay|yes|yeah|yep|yup|no|nope|nah|thanks|thank|thx|ty|cool|great|perfect|sure|lol|haha+|hah|nice|awesome|bet|hi|hello|hey|yo|sounds|deal|done|same|hmm+|wow|omg|sorry|np|true|agreed|definitely|absolutely|maybe|interested|available|when|where|what|why|how|who|which|please|pls|gotcha|alright|right|totally|exactly|congrats|welcome|bye|later|tomorrow|today|tonight|morning|afternoon|evening)[\s.!?]*$'
$f$;

-- Worth a quick AI look: numbers, contact words, odd spacing or lookalike letters
create or replace function public.contact_suspicious(t text) returns boolean
language plpgsql immutable as $$
declare n text := public.contact_norm(coalesce(t, '')); v text;
begin
  v := lower(n);
  return n is distinct from t
      or char_length(regexp_replace(v, '\D', '', 'g')) >= 6
      or (select count(*) from regexp_matches(v, '(?<![a-z])(zero|oh|one|two|three|four|five|six|seven|eight|nine)(?![a-z])', 'g')) >= 3
      or (select count(*) from regexp_matches(v, '(?<![a-z0-9])[a-z0-9](?![a-z0-9])', 'g')) >= 5
      or v ~ '[@$#]|https?|www|\.\s*(com|net|org|edu|me|io)'
      -- "X is Y" where Y could be a username ("gramercy is boazwc"), or a lone word that could be one ("boaz")
      or v ~ '(?<![a-z])(is|=|:)\s*@?[a-z][a-z0-9._-]{2,}[\s.!]*$'
         and substring(v from '([a-z][a-z0-9._-]{2,})[\s.!]*$') !~ '^(nice|good|great|fine|available|open|free|ready|mine|yours|here|there|done|sold|taken|cheap|close|small|big|clean|quiet|okay|true|right|wrong|perfect|awesome|amazing|included|furnished|new|old|cool|correct|possible|negotiable|flexible|due|late|soon|later|tomorrow|today|tonight|now|it|that|this|what|when|where|who|why|how|which|yes|no)$'
      or public.contact_lone_word(v)

      -- handle-like bits: bo-az-wc, s.a.m, sam_lee_22
      or v ~ '(?<![a-z0-9])[a-z0-9]{1,4}([-._][a-z0-9]{1,4}){2,}(?![a-z0-9])' and v !~ '^[0-9.\-/ ]*$'
      or v ~ '(?<![a-z0-9])[a-z]+[-_.][a-z0-9]+(?![a-z0-9])' and char_length(v) <= 12
      or v ~ '(?<![a-z])(numbers?|num|cell|phone|call|text|txt|sms|email|e-mail|mail|contact|reach|dm|pm|handle|user\s?name|add me|find me|look me up|search|follow|account|socials?|link|site|website|dot|com|edu|psu|gmail|outlook|yahoo|icloud|snap\w*|insta\w*|ig|venmo|zelle|cash\s?app|paypal|whats\s?app|telegram|discord|group\s?me|facebook|fb|linkedin|tiktok|twitter|hmu|hit me up|off (of )?rhedr|outside|backwards|reverse|digits)(?![a-z])';
end $$;

-- What a hidden message said, for rhedr.com/admin only (when a student is flagged, you can see why).
-- Students can't read this table; only the admin functions below can.
create table if not exists public.message_originals (
  message_id      bigint primary key references public.messages(id) on delete cascade,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_id       uuid,
  original        text not null,
  caught_by       text not null,          -- rule, split (sent in pieces), after_hidden, ai
  created_at      timestamptz not null default now()
);
alter table public.message_originals enable row level security;
revoke all on public.message_originals from anon, authenticated;

-- Students you limited on rhedr.com/admin: they can still read their chats, but can't send messages or start new ones.
create table if not exists public.limited_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  limited_at timestamptz not null default now(),
  reason     text
);
alter table public.limited_users enable row level security;
revoke all on public.limited_users from anon, authenticated;

create or replace function public.am_limited() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.limited_users where user_id = auth.uid()) $$;
revoke all on function public.am_limited() from public, anon;
grant execute on function public.am_limited() to authenticated;

-- C. Rules for every message -------------------------------------------------------------------------
-- Contact info split over several messages. Reads the sender's last 10 messages in this chat from the last
-- 15 minutes together with the new one ("814" / "555" / "1234", "boaz" / "psu" / "edu", "i" "n" "s" "t" "a" ...).
-- If together they show contact info, the earlier pieces (40 characters or less, plus any run of short pieces
-- just before them) are hidden too, and it returns true so the new message is hidden. Two readings:
--   * the messages joined with spaces, through the same rules as one message (numbers: exactly 10 digits)
--   * a run of short pieces (6 characters or less each) glued together without spaces
-- Runs as the database (security definer) because it changes earlier messages; it only touches the sender's own.
drop function if exists public.mask_split_contact(public.messages);
create or replace function public.mask_split_contact(n public.messages) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; ids bigint[] := '{}'; joined text := n.body; glued text := ''; run boolean := char_length(n.body) <= 6;
        hit boolean := false; j text; g text;
begin
  if run then glued := n.body; end if;
  for r in select m.id, m.body from public.messages m
            where m.conversation_id = n.conversation_id and m.sender_id = n.sender_id and not m.masked
              and m.created_at > now() - interval '15 minutes'
            order by m.id desc limit 10 loop
    if hit then   -- found it: also hide the rest of the run of short pieces just before ("814" before "555" "1234")
      if char_length(r.body) <= 12 then ids := ids || r.id; continue; else exit; end if;
    end if;
    exit when char_length(joined) > 300;   -- long messages were already checked on their own
    ids := ids || r.id;
    joined := r.body || ' ' || joined;
    if run and char_length(r.body) <= 6 then glued := r.body || glued; else run := false; end if;
    j := public.contact_norm(joined);
    if public.mask_contact(j) is distinct from trim(j) or public.contact_found(j, true) then hit := true; continue; end if;
    g := public.contact_norm(glued);
    if char_length(regexp_replace(g, '\s', '', 'g')) >= 5 and (
         public.mask_contact(g) is distinct from trim(g) or public.contact_found(g, true)
         or lower(regexp_replace(public.contact_deob(g), '[^a-z0-9@$]', '', 'g'))
            ~ '(@|insta|snap|venmo|zelle|cashapp|paypal|whatsapp|telegram|discord|groupme|facebook|linkedin|tiktok|twitter|gmail|yahoo|outlook|hotmail|icloud|psuedu|dotcom|dotedu)') then
      hit := true; end if;
  end loop;
  if not hit then return false; end if;
  insert into public.message_originals (message_id, conversation_id, sender_id, original, caught_by)
    select id, conversation_id, sender_id, body, 'split' from public.messages
     where id = any(ids) and sender_id = n.sender_id and char_length(body) <= 40
  on conflict (message_id) do nothing;
  update public.messages set body = '[contact info hidden]', masked = true
   where id = any(ids) and sender_id = n.sender_id and char_length(body) <= 40;
  return true;
end $$;
revoke all on function public.mask_split_contact(public.messages) from public, anon;
grant execute on function public.mask_split_contact(public.messages) to authenticated;

-- A student whose messages keep getting hidden shows up in "Chat reports" on rhedr.com/admin as an automatic flag
-- (from 3 hidden messages in a chat; if you mark it handled it comes back at every 5th hidden message).
alter table public.chat_reports add column if not exists auto boolean not null default false;
alter table public.chat_reports add column if not exists notified_at timestamptz;   -- when boaz@rhedr.com was emailed about it
create or replace function public.chat_autoflag(p_conv bigint, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int; rid bigint; open_now boolean;
begin
  if p_user is null then return; end if;
  select count(*) into n from public.messages where conversation_id = p_conv and sender_id = p_user and masked;
  if n >= 3 then
    insert into public.chat_reports (conversation_id, user_id, reason, auto)
    values (p_conv, p_user, format('Automatic flag: Rhedr hid contact info in %s of this student''s messages before the two agreed.', n), true)
    on conflict (conversation_id, user_id) do update set reason = excluded.reason,
           created_at = case when chat_reports.resolved_at is not null and n % 5 = 0 then now() else chat_reports.created_at end,
           resolved_at = case when n % 5 = 0 then null else chat_reports.resolved_at end,
           notified_at = case when chat_reports.resolved_at is not null and n % 5 = 0 then null else chat_reports.notified_at end
     where chat_reports.auto;
    select id, resolved_at is null and notified_at is null into rid, open_now
      from public.chat_reports where conversation_id = p_conv and user_id = p_user and auto;
    if open_now then perform public.chat_notify_admin(rid); end if;   -- one email per open flag (new, never emailed, or back after you marked it done)
  end if;
end $$;
-- Emails boaz@rhedr.com about a flag or a report, with a link straight to it on rhedr.com/admin (chat-emails function)
create or replace function public.chat_notify_admin(p_report bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.chat_reports set notified_at = now() where id = p_report;
  perform net.http_post(
    url := 'https://jszujotoetfhywyshxjq.supabase.co/functions/v1/chat-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-rhedr-job', (select secret from public.alert_job where id = 1)),
    body := jsonb_build_object('flag_report', p_report),
    timeout_milliseconds := 20000);
exception when others then null;   -- never let the email get in the way
end $$;
revoke all on function public.chat_notify_admin(bigint) from public, anon, authenticated;
revoke all on function public.chat_autoflag(bigint, uuid) from public, anon, authenticated;
grant execute on function public.chat_autoflag(bigint, uuid) to service_role;

alter table public.messages add column if not exists ai_check boolean not null default false;   -- sent for an AI look

-- Not "security definer" on purpose: current_user has to be the student (or the database, for notes from Rhedr).
create or replace function public.message_checks() returns trigger
language plpgsql set search_path = public as $$
declare c public.conversations; m text; orig text; how text;
begin
  perform set_config('rhedr.orig', '', true);
  if current_user in ('authenticated','anon') then
    new.sender_id := auth.uid();
    if new.sender_id is null then raise exception 'Sign in to send messages'; end if;
  end if;
  new.created_at := now();
  new.masked := false;
  new.ai_check := false;
  new.body := trim(coalesce(new.body, ''));
  if new.body = '' then raise exception 'Type a message first'; end if;
  select * into c from public.conversations where id = new.conversation_id;
  if not found then raise exception 'That chat no longer exists'; end if;
  if new.sender_id is null then return new; end if;   -- a note from Rhedr itself (only the database can write these)
  if new.sender_id not in (c.poster_id, c.student_id) then raise exception 'You''re not in this chat'; end if;
  if c.closed_at is not null then raise exception 'This chat is closed'; end if;
  if public.am_limited() then
    raise exception 'Messaging is paused on your account for now, because of repeated tries to share contact info before agreeing. If you think that''s a mistake, write to support@rhedr.com.';
  end if;
  if (select count(*) from public.messages x where x.sender_id = new.sender_id and x.created_at > now() - interval '1 minute') >= 15 then
    raise exception 'You''re sending messages very fast. Wait a minute and try again.'; end if;
  if (select count(*) from public.messages x where x.sender_id = new.sender_id and x.created_at > now() - interval '1 day') >= 400 then
    raise exception 'That''s the message limit for today. Try again tomorrow.'; end if;
  if c.agreed_at is null then
    -- a few letters at a time, over and over, is how people spell out a number or email past the filter:
    -- a 4th very short message (5 characters or less) in a row, with no reply from the other student in between
    if char_length(new.body) <= 5 and (
         select count(*) = 3 and bool_and(x.sender_id = new.sender_id and char_length(x.body) <= 5)
           from (select m2.sender_id, m2.body from public.messages m2
                  where m2.conversation_id = new.conversation_id and m2.created_at > now() - interval '10 minutes'
                  order by m2.id desc limit 3) x) then
      raise exception 'Please write your message in one go. Sending a few letters at a time is blocked, because it''s a common way to sneak contact info past Rhedr.';
    end if;
    orig := new.body;
    m := public.mask_message(new.body);
    if m is distinct from new.body then new.masked := true; new.body := m; how := 'rule'; end if;
    -- and the same check over your last few messages read together
    if not new.masked and public.mask_split_contact(new) then new.masked := true; new.body := '[contact info hidden]'; how := 'split'; end if;
    -- right after Rhedr hid your last message, a lone username-like word ("boazwc") is hidden too
    if not new.masked and public.contact_lone_word(new.body) and exists (
         select 1 from public.messages x
          where x.id = (select max(id) from public.messages where conversation_id = new.conversation_id)
            and x.sender_id = new.sender_id and x.masked and x.created_at > now() - interval '10 minutes') then
      new.masked := true; new.body := '[contact info hidden]'; how := 'after_hidden';
    end if;
    -- what it said, for the admin page (saved right after the message, in message_after)
    if new.masked then perform set_config('rhedr.orig', how || ':' || orig, true); end if;
    -- passed every rule but looks like it might be trying: a quick AI look right after it's saved (section C2)
    if not new.masked and (public.contact_suspicious(new.body) or (char_length(new.body) <= 6 and exists (
         select 1 from public.messages x where x.conversation_id = new.conversation_id and x.sender_id = new.sender_id
            and x.created_at > now() - interval '5 minutes' and char_length(x.body) <= 6)))
       and (select count(*) from public.messages x where x.sender_id = new.sender_id and x.ai_check and x.created_at > now() - interval '1 day') < 60 then
      new.ai_check := true;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists message_checks on public.messages;
create trigger message_checks before insert on public.messages for each row execute function public.message_checks();

-- the chat moves to the top of both inboxes, and the sender has read everything up to their own message.
-- Also: repeat tries get flagged, and suspicious messages go to the AI check.
create or replace function public.message_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations c set last_message_at = new.created_at,
         poster_read_at  = case when new.sender_id = c.poster_id  then new.created_at else c.poster_read_at end,
         student_read_at = case when new.sender_id = c.student_id then new.created_at else c.student_read_at end
   where c.id = new.conversation_id;
  if new.masked and coalesce(current_setting('rhedr.orig', true), '') like '%:%' and new.sender_id is not null then
    insert into public.message_originals (message_id, conversation_id, sender_id, original, caught_by)
    values (new.id, new.conversation_id, new.sender_id, substr(current_setting('rhedr.orig', true), strpos(current_setting('rhedr.orig', true), ':') + 1),
            split_part(current_setting('rhedr.orig', true), ':', 1))
    on conflict (message_id) do nothing;
    perform set_config('rhedr.orig', '', true);
  end if;
  if new.masked then perform public.chat_autoflag(new.conversation_id, new.sender_id); end if;
  if new.ai_check then
    begin   -- never let the AI check get in the way of sending
      perform net.http_post(
        url := 'https://jszujotoetfhywyshxjq.supabase.co/functions/v1/chat-emails',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-rhedr-job', (select secret from public.alert_job where id = 1)),
        body := jsonb_build_object('check_message', new.id),
        timeout_milliseconds := 20000);
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists message_after on public.messages;
create trigger message_after after insert on public.messages for each row execute function public.message_after();

-- C2. The AI check -----------------------------------------------------------------------------------------
-- The chat-emails Edge Function gets {"check_message": id}, asks Claude (a small, cheap model) whether the message,
-- read with the chat around it, is a way of sharing contact info, and if so calls this to hide it. Only the
-- sender's own messages in a chat that isn't agreed yet can be hidden this way.
create or replace function public.chat_ai_hide(p_msg bigint, p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare m public.messages; n int;
begin
  select * into m from public.messages where id = p_msg;
  if not found or m.sender_id is null then return 0; end if;
  if (select agreed_at from public.conversations where id = m.conversation_id) is not null then return 0; end if;
  insert into public.message_originals (message_id, conversation_id, sender_id, original, caught_by)
    select id, conversation_id, sender_id, body, 'ai' from public.messages
     where conversation_id = m.conversation_id and sender_id = m.sender_id and not masked
       and id = any(array_append(p_ids, p_msg)) and created_at > now() - interval '1 hour'
  on conflict (message_id) do nothing;
  update public.messages set body = '[contact info hidden]', masked = true
   where conversation_id = m.conversation_id and sender_id = m.sender_id and not masked
     and id = any(array_append(p_ids, p_msg)) and created_at > now() - interval '1 hour';
  get diagnostics n = row_count;
  if n > 0 then perform public.chat_autoflag(m.conversation_id, m.sender_id); end if;
  return n;
end $$;
revoke all on function public.chat_ai_hide(bigint, bigint[]) from public, anon, authenticated;
grant execute on function public.chat_ai_hide(bigint, bigint[]) to service_role;

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
  perform public.chat_notify_admin((select id from public.chat_reports where conversation_id = p_conv and user_id = auth.uid()));
end $$;

-- For rhedr.com/admin: reported and flagged chats, with their messages. "flagged" is the student Rhedr flagged
-- (automatic flags) or the one who was reported. "why" lists the hidden messages with what they really said.
drop function if exists public.chat_report_queue(boolean);
create or replace function public.chat_report_queue(p_done boolean default false)
returns table (report_id bigint, created_at timestamptz, reason text, reporter text, resolved_at timestamptz,
               conversation_id bigint, sublet_id bigint, sublet_title text, poster text, student text,
               agreed_at timestamptz, closed_at timestamptz, messages jsonb,
               auto boolean, flagged_id uuid, flagged_email text, flagged_role text, flagged_limited boolean, why jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can see this'; end if;
  return query
    select r.id, r.created_at, r.reason,
           case when r.auto then 'Rhedr (automatic flag)' else ru.email::text end,
           r.resolved_at, c.id, c.sublet_id, c.sublet_title,
           pu.email::text, su.email::text, c.agreed_at, c.closed_at,
           (select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'masked', m.masked, 'body', m.body,
                    'from', case when m.sender_id is null then 'Rhedr' when m.sender_id = c.poster_id then 'Poster' else 'Student' end) order by m.id), '[]')
              from public.messages m where m.conversation_id = c.id),
           r.auto, f.fid, fu.email::text, case when f.fid = c.poster_id then 'poster' else 'student' end,
           exists (select 1 from public.limited_users l where l.user_id = f.fid),
           (select coalesce(jsonb_agg(jsonb_build_object('at', o.created_at, 'caught_by', o.caught_by, 'original', o.original,
                    'from', case when o.sender_id = c.poster_id then 'Poster' else 'Student' end,
                    'flagged', o.sender_id = f.fid) order by o.message_id), '[]')
              from public.message_originals o where o.conversation_id = c.id)
      from public.chat_reports r join public.conversations c on c.id = r.conversation_id
      cross join lateral (select case when r.auto then r.user_id when r.user_id = c.poster_id then c.student_id else c.poster_id end as fid) f
      left join auth.users ru on ru.id = r.user_id left join auth.users pu on pu.id = c.poster_id
      left join auth.users su on su.id = c.student_id left join auth.users fu on fu.id = f.fid
     where (r.resolved_at is null) <> p_done
     order by r.created_at desc limit 100;
end $$;

-- Limit or unlimit a student from rhedr.com/admin
create or replace function public.chat_limit(p_user uuid, p_limit boolean default true, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Rhedr admins can do this'; end if;
  if p_limit then
    insert into public.limited_users (user_id, reason) values (p_user, left(p_reason, 500))
    on conflict (user_id) do update set reason = coalesce(excluded.reason, limited_users.reason);
  else
    delete from public.limited_users where user_id = p_user;
  end if;
end $$;
revoke all on function public.chat_limit(uuid, boolean, text) from public, anon;
grant execute on function public.chat_limit(uuid, boolean, text) to authenticated;

-- For the chat-emails function: what the admin email about a flag or report says
create or replace function public.chat_flag_info(p_report bigint)
returns table (report_id bigint, auto boolean, reason text, sublet_title text, flagged_email text, hidden int)
language sql stable security definer set search_path = public as $$
  select r.id, r.auto, r.reason, c.sublet_title, fu.email::text,
         (select count(*)::int from public.messages m where m.conversation_id = c.id and m.sender_id = f.fid and m.masked)
    from public.chat_reports r join public.conversations c on c.id = r.conversation_id
    cross join lateral (select case when r.auto then r.user_id when r.user_id = c.poster_id then c.student_id else c.poster_id end as fid) f
    left join auth.users fu on fu.id = f.fid
   where r.id = p_report $$;
revoke all on function public.chat_flag_info(bigint) from public, anon, authenticated;
grant execute on function public.chat_flag_info(bigint) to service_role;

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
  public.chat_report_queue(boolean), public.chat_report_resolve(bigint, boolean), public.in_chat(bigint), public.mask_contact(text),
  public.mask_message(text), public.mask_text(text), public.contact_norm(text)
  to authenticated;

-- Phone numbers and emails in a listing would skip the chat, so the listing's text gets the same treatment.
-- (Triggers run in name order, so the scam checks in setup.sql still see the original wording first.)
create or replace function public.sublet_mask() returns trigger
language plpgsql as $$
begin
  new.description := public.mask_text(new.description);
  new.roommates := public.mask_text(new.roommates);
  return new;
end $$;
drop trigger if exists zy_sublet_mask on public.sublets;
create trigger zy_sublet_mask before insert or update of description, roommates on public.sublets
  for each row when (current_user in ('authenticated','anon')) execute function public.sublet_mask();

-- When the hiding rules get stricter, apply them to what's already saved too (chats not yet agreed, and listings)
update public.messages m set body = public.mask_message(m.body), masked = true
  from public.conversations c
 where c.id = m.conversation_id and c.agreed_at is null and m.sender_id is not null and not m.masked
   and public.mask_message(m.body) is distinct from m.body;
update public.sublets s set description = public.mask_text(s.description), roommates = public.mask_text(s.roommates)
 where public.mask_text(s.description) is distinct from s.description
    or public.mask_text(s.roommates) is distinct from s.roommates;

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
