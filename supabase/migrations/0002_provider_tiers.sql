-- Separate "we paid to be here" from "we checked this person's licence", and
-- give the directory a curation lever.
--
-- `verified` was set at ingest from cedulas.length > 0 — a Mexican professional
-- licence number scraped off the profile. It is true for 1,720 of 4,067 rows,
-- which made the gold Verified badge the default state of the directory rather
-- than a mark of anything, and gave away the one visible thing a paid listing
-- was supposed to buy.
--
-- So the licence fact moves to its own column and keeps its meaning, and
-- `verified` becomes a function of the plan. Nothing is lost: the badge that
-- was on screen is still on screen, just labelled as what it actually is.
--
-- Run in: Supabase dashboard -> SQL editor.

alter table public.providers
    add column if not exists tier text not null default 'basic'
        check (tier in ('basic', 'promoted', 'featured')),
    -- Credential we scraped, not credential we sold. Keeps the cedula signal.
    add column if not exists licensed boolean not null default false,
    -- Manual curation. Nulls sort last; low numbers surface first. Lets the
    -- team put clinics with real photography on row one without a deploy.
    add column if not exists "featuredRank" integer;

-- 1. Preserve the credential fact before overwriting the column it lived in.
update public.providers set licensed = true where verified;

-- 2. Carry the existing promoted flag onto the new tier, so whoever is already
--    marked promoted keeps their placement.
update public.providers set tier = 'promoted' where promoted and tier = 'basic';

-- 3. Verified now means paid. Nobody has paid yet, so this is the honest state.
update public.providers set verified = (tier <> 'basic');

create index if not exists providers_tier_idx on public.providers (tier);
create index if not exists providers_featured_rank_idx
    on public.providers ("featuredRank") where "featuredRank" is not null;

-- A postal code of all zeros is what the address backfill wrote when it found
-- five digits that were not a postal code. Eight rows, and every one of them
-- answers a "near 00000" search with a five-kilometre circle around nothing.
update public.providers set "postalCode" = null where "postalCode" = '00000';
