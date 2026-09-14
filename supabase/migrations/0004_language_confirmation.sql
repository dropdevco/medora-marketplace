-- The `languages` column has never held a real fact. All three ingestion
-- paths fabricated it: scripts/seed-providers.ts guessed ['es','en'] or
-- ['en','es'] by country, scripts/doctoralia/parse.ts hardcoded ['es'], and
-- scripts/doctoralia/load.ts / promote-google.ts then overwrote even that
-- guess with a hardcoded ['es','en']. The result, checked live: 100% of
-- 4,067 providers carry the identical bilingual claim, with zero real signal
-- behind any of it — the scraped bio text mentions a language in 8 of 2,794
-- profiles.
--
-- Whether a clinic actually speaks English is exactly the kind of fact a
-- patient decides on, so it has to be a fact, not a guess. This clears the
-- fabricated data and adds a column that can only become true by someone
-- actually stating it — a clinic through its own dashboard, or us by hand.
--
-- Run in: Supabase dashboard -> SQL editor.

alter table public.providers
    add column if not exists languages_confirmed boolean not null default false;

-- Nothing here was ever a real answer. Clearing it is not information loss —
-- there was no information to lose — it is un-asserting a claim nobody made.
update public.providers
set languages = '{}', languages_confirmed = false
where languages_confirmed = false;

-- Auto-confirms the moment `languages` is genuinely changed by anyone with
-- write access to the column — which today is only an owner, through the RLS
-- policy and column grant from migration 0003, since the client never gets a
-- direct grant on `languages_confirmed` itself. A clinic cannot claim
-- "confirmed" without actually supplying real languages; it also cannot
-- un-confirm by clearing the field back to empty, since an owner clearing
-- their own answer is still a deliberate, real statement about themselves.
create or replace function public.confirm_languages_on_change()
returns trigger
language plpgsql
as $$
begin
    if new.languages is distinct from old.languages then
        new.languages_confirmed := true;
    end if;
    return new;
end;
$$;

drop trigger if exists languages_confirmed_on_change on public.providers;
create trigger languages_confirmed_on_change
    before update on public.providers
    for each row
    execute function public.confirm_languages_on_change();
