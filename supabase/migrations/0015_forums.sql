-- Two forums on one pair of tables.
--
--   patients  "Ask a Doctor" — public Q&A. Anyone signed in may ask; only a
--             clinician (someone who owns a claimed listing) may answer, plus
--             the person who asked, for follow-ups. A doctor's answer carries
--             their listing, which is the marketing they get for helping.
--   society   "Med Society" — clinicians only, to read and to write. The team
--             seeds it with prompts (is_prompt) through the service role
--             (scripts/society-prompt.ts); doctors answer and talk among
--             themselves.
--
-- One table with a `forum` column rather than two copies of everything: the
-- shape is identical, and what differs is who may read and who may write,
-- which is exactly what the policies below are for.
--
-- Moderation is `hidden`, set by the service role. A hidden post disappears
-- for everyone but its author, so removing one does not tip off a spammer
-- that they need a new account.

-- ── Who is a clinician ──────────────────────────────────────────────────────
-- SECURITY DEFINER for the same reason as owns_provider: the policies ask it,
-- and provider_owners has RLS of its own. Returns a boolean about the caller
-- and nothing else.
create or replace function public.is_clinician()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (select 1 from public.provider_owners where user_id = auth.uid());
$$;

revoke all on function public.is_clinician() from public;
grant execute on function public.is_clinician() to anon, authenticated;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.forum_threads (
    id                 uuid primary key default gen_random_uuid(),
    forum              text not null check (forum in ('patients', 'society')),
    -- Null only for team prompts, which the service role inserts.
    author_id          uuid default auth.uid() references auth.users (id) on delete cascade,
    -- What the post is signed with. A patient picks it; a clinician's is
    -- their listing's name, but the listing below is what the UI prefers.
    author_name        text not null check (char_length(author_name) between 1 and 80),
    -- The listing a clinician posts as. Must be one they own (policy below).
    provider_id        uuid references public.providers (id) on delete set null,
    title              text not null check (char_length(title) between 5 and 200),
    body               text not null default '' check (char_length(body) <= 5000),
    -- A Specialty key (src/types/provider.ts), so a question about braces can
    -- find orthodontists. Free text in the database; the UI offers the list.
    specialty          text check (char_length(specialty) <= 40),
    is_prompt          boolean not null default false,
    pinned             boolean not null default false,
    hidden             boolean not null default false,
    -- Maintained by triggers; not writable from any client.
    reply_count        integer not null default 0,
    doctor_reply_count integer not null default 0,
    last_activity_at   timestamptz not null default now(),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz
);

create index if not exists forum_threads_list_idx
    on public.forum_threads (forum, pinned desc, last_activity_at desc);
create index if not exists forum_threads_unanswered_idx
    on public.forum_threads (forum, created_at desc) where doctor_reply_count = 0;

create table if not exists public.forum_replies (
    id            uuid primary key default gen_random_uuid(),
    thread_id     uuid not null references public.forum_threads (id) on delete cascade,
    author_id     uuid default auth.uid() references auth.users (id) on delete cascade,
    author_name   text not null check (char_length(author_name) between 1 and 80),
    provider_id   uuid references public.providers (id) on delete set null,
    body          text not null check (char_length(body) between 1 and 5000),
    hidden        boolean not null default false,
    helpful_count integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz
);

create index if not exists forum_replies_thread_idx on public.forum_replies (thread_id, created_at);
-- "Answers from this doctor" on a provider page.
create index if not exists forum_replies_provider_idx
    on public.forum_replies (provider_id, created_at desc) where provider_id is not null;

create table if not exists public.forum_helpful (
    reply_id   uuid not null references public.forum_replies (id) on delete cascade,
    user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (reply_id, user_id)
);

-- ── Counters ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the counter columns are deliberately not granted to
-- clients: a reply may bump its thread, a person may not.
create or replace function public.forum_reply_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'INSERT' then
        update public.forum_threads
           set reply_count = reply_count + 1,
               doctor_reply_count = doctor_reply_count + (new.provider_id is not null)::int,
               last_activity_at = now()
         where id = new.thread_id;
        return new;
    else
        update public.forum_threads
           set reply_count = greatest(reply_count - 1, 0),
               doctor_reply_count = greatest(doctor_reply_count - (old.provider_id is not null)::int, 0)
         where id = old.thread_id;
        return old;
    end if;
end;
$$;

drop trigger if exists forum_reply_counts on public.forum_replies;
create trigger forum_reply_counts
    after insert or delete on public.forum_replies
    for each row execute function public.forum_reply_counts();

create or replace function public.forum_helpful_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'INSERT' then
        update public.forum_replies set helpful_count = helpful_count + 1 where id = new.reply_id;
        return new;
    else
        update public.forum_replies set helpful_count = greatest(helpful_count - 1, 0) where id = old.reply_id;
        return old;
    end if;
end;
$$;

drop trigger if exists forum_helpful_counts on public.forum_helpful;
create trigger forum_helpful_counts
    after insert or delete on public.forum_helpful
    for each row execute function public.forum_helpful_counts();

-- Trigger-only. Supabase grants EXECUTE to anon/authenticated by default, so
-- revoking from public alone leaves them reachable at /rest/v1/rpc.
revoke all on function public.forum_reply_counts() from public, anon, authenticated;
revoke all on function public.forum_helpful_counts() from public, anon, authenticated;

-- ── Row policies ────────────────────────────────────────────────────────────
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;
alter table public.forum_helpful enable row level security;

-- Patients forum: public. Society: clinicians only. Hidden: author only.
drop policy if exists "read threads" on public.forum_threads;
create policy "read threads" on public.forum_threads
    for select to anon, authenticated
    using (
        (not hidden or author_id = auth.uid())
        and (forum = 'patients' or public.is_clinician())
    );

-- Anyone signed in may ask in the patients forum, as themselves or as a
-- listing they own. Society posts must be signed with an owned listing, so
-- every voice in there is a verified practice.
drop policy if exists "post threads" on public.forum_threads;
create policy "post threads" on public.forum_threads
    for insert to authenticated
    with check (
        author_id = auth.uid()
        and (provider_id is null or public.owns_provider(provider_id))
        and (forum = 'patients' or (forum = 'society' and provider_id is not null))
    );

drop policy if exists "edit own threads" on public.forum_threads;
create policy "edit own threads" on public.forum_threads
    for update to authenticated
    using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "delete own threads" on public.forum_threads;
create policy "delete own threads" on public.forum_threads
    for delete to authenticated using (author_id = auth.uid());

-- A reply is readable when its thread is (the subquery runs under the thread
-- policy above, so society replies stay with clinicians).
drop policy if exists "read replies" on public.forum_replies;
create policy "read replies" on public.forum_replies
    for select to anon, authenticated
    using (
        (not hidden or author_id = auth.uid())
        and exists (select 1 from public.forum_threads t where t.id = forum_replies.thread_id)
    );

-- Patients forum: a clinician answering as an owned listing, or the asker
-- following up on their own question. Other patients do not answer medical
-- questions here; that is the point of the forum. Society: clinicians, signed
-- with an owned listing.
drop policy if exists "post replies" on public.forum_replies;
create policy "post replies" on public.forum_replies
    for insert to authenticated
    with check (
        author_id = auth.uid()
        and (provider_id is null or public.owns_provider(provider_id))
        -- Qualified: forum_threads has a provider_id too, and a bare one in
        -- the subquery would silently mean the thread's.
        and exists (
            select 1 from public.forum_threads t
            where t.id = forum_replies.thread_id
              and not t.hidden
              and (
                  forum_replies.provider_id is not null
                  or (t.forum = 'patients' and t.author_id = auth.uid())
              )
        )
    );

drop policy if exists "edit own replies" on public.forum_replies;
create policy "edit own replies" on public.forum_replies
    for update to authenticated
    using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "delete own replies" on public.forum_replies;
create policy "delete own replies" on public.forum_replies
    for delete to authenticated using (author_id = auth.uid());

-- Only your own marks are readable: the count is on the reply.
drop policy if exists "own helpful marks" on public.forum_helpful;
create policy "own helpful marks" on public.forum_helpful
    for select to authenticated using (user_id = auth.uid());

drop policy if exists "mark helpful" on public.forum_helpful;
create policy "mark helpful" on public.forum_helpful
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.forum_replies r where r.id = reply_id)
    );

drop policy if exists "unmark helpful" on public.forum_helpful;
create policy "unmark helpful" on public.forum_helpful
    for delete to authenticated using (user_id = auth.uid());

-- ── Column grants ───────────────────────────────────────────────────────────
-- As with providers: the policies decide which rows, these decide which
-- columns. Absent here and so unwritable from a client: author_id (defaults
-- to the caller), is_prompt, pinned, hidden, and every counter.
revoke all on public.forum_threads from anon, authenticated;
revoke all on public.forum_replies from anon, authenticated;
revoke all on public.forum_helpful from anon, authenticated;

grant select on public.forum_threads to anon, authenticated;
grant insert (forum, author_name, provider_id, title, body, specialty) on public.forum_threads to authenticated;
grant update (title, body, specialty, updated_at) on public.forum_threads to authenticated;
grant delete on public.forum_threads to authenticated;

grant select on public.forum_replies to anon, authenticated;
grant insert (thread_id, author_name, provider_id, body) on public.forum_replies to authenticated;
grant update (body, updated_at) on public.forum_replies to authenticated;
grant delete on public.forum_replies to authenticated;

grant select on public.forum_helpful to authenticated;
grant insert (reply_id) on public.forum_helpful to authenticated;
grant delete on public.forum_helpful to authenticated;
