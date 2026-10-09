-- Email notifications for the forums (api/forum-notify.ts, api/forum-unsubscribe.ts).
--
--   1. A MedSociety team prompt in Med Society    -> every clinician, at once
--   2. Unanswered patient questions               -> clinicians, one daily digest,
--                                                    filtered to their specialties
--   3. A clinician answers a patient's question   -> that patient, at once
--
-- No database webhooks (pg_net is not installed here). The browser tells
-- /api/forum-notify "I just posted row X"; the function re-reads X with the
-- service role and decides for itself. `notified_at` makes every send happen
-- at most once, so the endpoint needs no secret: a caller can only cause the
-- one email the row already warranted, a little early. The daily cron sweeps
-- up any row whose author closed the tab before telling us.

-- ── Per-row bookkeeping ─────────────────────────────────────────────────────
alter table public.forum_threads
    add column if not exists notified_at timestamptz,
    -- The language the question was asked in, so the "you got an answer"
    -- email is written in it.
    add column if not exists lang text check (lang in ('en', 'es'));

alter table public.forum_replies
    add column if not exists notified_at timestamptz;

grant insert (lang) on public.forum_threads to authenticated;

-- ── Preferences ─────────────────────────────────────────────────────────────
-- One row per person who has ever been sent something. Created lazily by the
-- recipient functions below, which is also what mints the unsubscribe token.
create table if not exists public.notification_prefs (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    prompts    boolean not null default true,   -- 1. team prompts (clinicians)
    digest     boolean not null default true,   -- 2. daily question digest (clinicians)
    answers    boolean not null default true,   -- 3. "a doctor answered you" (patients)
    token      uuid not null unique default gen_random_uuid(),
    updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists "own prefs" on public.notification_prefs;
create policy "own prefs" on public.notification_prefs
    for select to authenticated using (user_id = auth.uid());
drop policy if exists "edit own prefs" on public.notification_prefs;
create policy "edit own prefs" on public.notification_prefs
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notification_prefs from anon, authenticated;
grant select (user_id, prompts, digest, answers, updated_at) on public.notification_prefs to authenticated;
grant update (prompts, digest, answers, updated_at) on public.notification_prefs to authenticated;

-- One digest per clinician per day, however many times the cron fires.
create table if not exists public.forum_digest_log (
    user_id uuid not null references auth.users (id) on delete cascade,
    sent_on date not null,
    sent_at timestamptz not null default now(),
    primary key (user_id, sent_on)
);
alter table public.forum_digest_log enable row level security;
revoke all on public.forum_digest_log from anon, authenticated;

-- ── Recipient lookups (service role only) ──────────────────────────────────
-- SECURITY DEFINER because emails live in auth.users, which PostgREST does not
-- expose. Execute is revoked from every client role at the bottom; only the
-- server, holding the service-role key, can call these.

-- Every clinician, with the language and specialties of their listings.
-- Spanish when any listing they own is in Mexico.
create or replace function public.forum_clinician_recipients(p_kind text)
returns table (user_id uuid, email text, lang text, token uuid, specialties text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
    if p_kind not in ('prompts', 'digest') then
        raise exception 'unknown kind %', p_kind;
    end if;

    insert into public.notification_prefs (user_id)
    select distinct o.user_id from public.provider_owners o
    on conflict (user_id) do nothing;

    return query
    select u.id,
           u.email::text,
           case when bool_or(p.country = 'MX') then 'es' else 'en' end,
           np.token,
           coalesce(array_agg(distinct s) filter (where s is not null), '{}')
    from public.provider_owners o
    join auth.users u on u.id = o.user_id
    join public.notification_prefs np on np.user_id = u.id
    join public.providers p on p.id = o.provider_id
    left join lateral unnest(p.specialty) s on true
    where u.email is not null
      and u.email_confirmed_at is not null
      and case p_kind when 'prompts' then np.prompts else np.digest end
    group by u.id, u.email, np.token;
end;
$$;

-- One person, for the "a doctor answered you" email. Null when they opted out
-- or have no confirmed email.
create or replace function public.forum_user_contact(p_user uuid)
returns table (email text, token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
    insert into public.notification_prefs (user_id) values (p_user)
    on conflict (user_id) do nothing;

    return query
    select u.email::text, np.token
    from auth.users u
    join public.notification_prefs np on np.user_id = u.id
    where u.id = p_user
      and u.email is not null
      and u.email_confirmed_at is not null
      and np.answers;
end;
$$;

-- The unsubscribe link. The token is the credential: unguessable, per person,
-- and it can only ever turn an email *off*.
create or replace function public.forum_unsubscribe(p_token uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
    update public.notification_prefs set
        prompts = case when p_kind in ('prompts', 'all') then false else prompts end,
        digest  = case when p_kind in ('digest',  'all') then false else digest  end,
        answers = case when p_kind in ('answers', 'all') then false else answers end,
        updated_at = now()
    where token = p_token;
    get diagnostics n = row_count;
    return n > 0;
end;
$$;

revoke all on function public.forum_clinician_recipients(text) from public, anon, authenticated;
revoke all on function public.forum_user_contact(uuid) from public, anon, authenticated;
revoke all on function public.forum_unsubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.forum_clinician_recipients(text) to service_role;
grant execute on function public.forum_user_contact(uuid) to service_role;
grant execute on function public.forum_unsubscribe(uuid, text) to service_role;
