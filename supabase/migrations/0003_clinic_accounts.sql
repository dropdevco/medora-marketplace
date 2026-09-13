-- Clinic accounts: claiming a listing, owning it, and editing it.
--
-- Until now the directory was read-only to everyone and there was no auth at
-- all. This is the minimum that lets a clinic do something after it claims a
-- listing, which is the question the last review ended on.
--
-- The shape is deliberately two tables rather than one flag on `providers`:
-- a claim is a request with a history, and ownership is the decision. Keeping
-- them apart means a rejected claim is still on record, and a listing can have
-- two owners (a doctor and an office manager) without inventing a second flag.
--
-- Run in: Supabase dashboard -> SQL editor.

-- ── Columns a clinic can fill in about itself ────────────────────────────────
alter table public.providers
    add column if not exists description text,
    -- Opening hours, as {"mon": [["09:00","14:00"], ["16:00","19:00"]], ...}.
    -- jsonb because split shifts are the norm in Juarez and a pair of time
    -- columns cannot hold them.
    add column if not exists hours jsonb,
    add column if not exists updated_at timestamptz,
    add column if not exists updated_by uuid references auth.users (id);

-- ── Ownership ───────────────────────────────────────────────────────────────
create table if not exists public.provider_owners (
    provider_id uuid not null references public.providers (id) on delete cascade,
    user_id     uuid not null references auth.users (id) on delete cascade,
    role        text not null default 'owner' check (role in ('owner', 'staff')),
    created_at  timestamptz not null default now(),
    primary key (provider_id, user_id)
);

create index if not exists provider_owners_user_idx on public.provider_owners (user_id);

create table if not exists public.provider_claims (
    id          uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.providers (id) on delete cascade,
    user_id     uuid not null references auth.users (id) on delete cascade,
    status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
    -- How they say they can prove it: a work email, a cedula, a phone on the
    -- listing. Reviewed by a person; nothing here grants anything by itself.
    evidence    text check (char_length(evidence) <= 2000),
    created_at  timestamptz not null default now(),
    reviewed_at timestamptz,
    -- One open claim per person per listing. A second attempt updates the
    -- first rather than queueing a duplicate for whoever reviews these.
    unique (provider_id, user_id)
);

create index if not exists provider_claims_status_idx on public.provider_claims (status, created_at desc);

-- ── Photos the clinic uploads itself ────────────────────────────────────────
-- Distinct from Google's photos, which we may not store (their terms permit
-- retaining only place_id) and which expire. These are ours to keep.
create table if not exists public.provider_photos (
    id           uuid primary key default gen_random_uuid(),
    provider_id  uuid not null references public.providers (id) on delete cascade,
    storage_path text not null,
    sort         integer not null default 0,
    created_at   timestamptz not null default now(),
    created_by   uuid references auth.users (id)
);

create index if not exists provider_photos_provider_idx
    on public.provider_photos (provider_id, sort);

-- ── Who owns what ───────────────────────────────────────────────────────────
-- SECURITY DEFINER so the providers policies can ask this question without
-- re-entering RLS on provider_owners and recursing. It reads one row by
-- primary key and returns a boolean; it cannot be used to read anything else.
create or replace function public.owns_provider(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.provider_owners
        where provider_id = target and user_id = auth.uid()
    );
$$;

revoke all on function public.owns_provider(uuid) from public;
grant execute on function public.owns_provider(uuid) to authenticated;

-- ── Row policies ────────────────────────────────────────────────────────────
alter table public.provider_owners enable row level security;
alter table public.provider_claims enable row level security;
alter table public.provider_photos enable row level security;

-- Owners see their own rows. Nobody writes this table from the client:
-- ownership is granted by review, i.e. by the service role.
drop policy if exists "owners read own" on public.provider_owners;
create policy "owners read own" on public.provider_owners
    for select to authenticated using (user_id = auth.uid());

-- Anyone signed in may claim; they may read and amend only their own claim,
-- and `status` is not theirs to set — see the column grants below.
drop policy if exists "claim own" on public.provider_claims;
create policy "claim own" on public.provider_claims
    for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "read own claims" on public.provider_claims;
create policy "read own claims" on public.provider_claims
    for select to authenticated using (user_id = auth.uid());

drop policy if exists "update own pending claims" on public.provider_claims;
create policy "update own pending claims" on public.provider_claims
    for update to authenticated
    using (user_id = auth.uid() and status = 'pending')
    with check (user_id = auth.uid() and status = 'pending');

-- Clinic photos are public to read (they are on a public listing) and
-- writable only by the listing's owners.
drop policy if exists "public reads clinic photos" on public.provider_photos;
create policy "public reads clinic photos" on public.provider_photos
    for select to anon, authenticated using (true);

drop policy if exists "owners write clinic photos" on public.provider_photos;
create policy "owners write clinic photos" on public.provider_photos
    for all to authenticated
    using (public.owns_provider(provider_id))
    with check (public.owns_provider(provider_id));

-- Owners may edit their own listing. Which *columns* they may edit is not
-- something a row policy can express, so it is enforced by column grants
-- below; this decides only which rows.
drop policy if exists "owners update own listing" on public.providers;
create policy "owners update own listing" on public.providers
    for update to authenticated
    using (public.owns_provider(id))
    with check (public.owns_provider(id));

-- ── Column grants: the actual edit whitelist ────────────────────────────────
-- Postgres has no column filter in RLS, so the table-wide UPDATE privilege is
-- withdrawn and handed back one column at a time. Absent from this list, and
-- therefore unwritable from any client no matter what the policy says:
--   tier, promoted, verified, featuredRank  -- what we sell, and placement
--   rating, reviewCount, clicks             -- measurements, not claims
--   lat, lng, country, source, id           -- identity and geocoding
-- A clinic that could set its own tier would be able to award itself the badge
-- the plan exists to sell.
revoke update on public.providers from anon, authenticated;
grant update (
    name, phone, website, email, address, city, "postalCode",
    specialty, languages, insurances, services, "priceFromMxn",
    "bookingUrl", "imageUrl", description, hours,
    updated_at, updated_by
) on public.providers to authenticated;

revoke update on public.provider_claims from anon, authenticated;
grant update (evidence) on public.provider_claims to authenticated;

-- ── Storage for clinic photos ───────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('clinic-photos', 'clinic-photos', true)
on conflict (id) do nothing;

-- Files live under <provider_id>/<filename>, so the first path segment is the
-- listing and ownership of the row is ownership of the folder.
drop policy if exists "public reads clinic photo files" on storage.objects;
create policy "public reads clinic photo files" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'clinic-photos');

drop policy if exists "owners write clinic photo files" on storage.objects;
create policy "owners write clinic photo files" on storage.objects
    for all to authenticated
    using (
        bucket_id = 'clinic-photos'
        and public.owns_provider(((storage.foldername(name))[1])::uuid)
    )
    with check (
        bucket_id = 'clinic-photos'
        and public.owns_provider(((storage.foldername(name))[1])::uuid)
    );
