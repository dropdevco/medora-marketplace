-- Border health survey → clinic onboarding.
--
-- The survey (bh_responses, see borderhealth-survey/schema.sql) moved into
-- medsociety.one/borderhealth. A provider who finishes it is, by definition,
-- a clinic we want in the directory, so the end of the form becomes the start
-- of onboarding: find their listing and claim it, or ask to publish a new one.
--
-- Three RPCs, all callable from the browser:
--   bh_match_providers  anon    who in the directory looks like this person
--   bh_claim_provider   authed  claim a match; instant only on a verified email
--   bh_submit_listing   authed  ask for a new listing, hidden until reviewed
--
-- Run in: Supabase dashboard -> SQL editor (or apply_migration).

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ── Listing status ───────────────────────────────────────────────────────────
-- 'pending' is a self-submitted listing nobody has looked at yet. It must not
-- reach the public directory, but its owner has to see it to edit it.
alter table public.providers
    add column if not exists status text not null default 'live'
        check (status in ('live', 'pending', 'hidden'));

drop policy if exists "Public can read providers" on public.providers;
create policy "Public can read providers" on public.providers
    for select to anon, authenticated using (status = 'live');

-- Separate policy rather than `or owns_provider(id)` above: anon has no
-- execute on owns_provider, and one policy mentioning it would error for anon.
drop policy if exists "owners read own listing" on public.providers;
create policy "owners read own listing" on public.providers
    for select to authenticated using (public.owns_provider(id));

-- ── Linking a survey row to what came of it ──────────────────────────────────
-- Anon cannot read bh_responses, so the browser cannot get the row id back.
-- It generates submission_key itself and hands it to the RPCs afterwards.
alter table public.bh_responses
    add column if not exists submission_key uuid unique,
    add column if not exists user_id     uuid references auth.users (id) on delete set null,
    add column if not exists provider_id uuid references public.providers (id) on delete set null,
    add column if not exists claim_id    uuid references public.provider_claims (id) on delete set null,
    -- claimed | claim_pending | listing_pending
    add column if not exists outcome     text;

-- Same limits as before, plus: the link columns are written by the RPCs only.
drop policy if exists bh_responses_insert_anon on public.bh_responses;
create policy bh_responses_insert_anon
  on public.bh_responses for insert to anon, authenticated
  with check (
    coalesce(length(session),       0) <= 40  and
    coalesce(length(ref),           0) <= 40  and
    coalesce(length(client_id),     0) <= 40  and
    coalesce(length(industry),      0) <= 80  and
    coalesce(length(city),          0) <= 80  and
    coalesce(length(contact_name),  0) <= 120 and
    coalesce(length(contact_org),   0) <= 160 and
    coalesce(length(contact_email), 0) <= 160 and
    coalesce(length(contact_phone), 0) <= 40  and
    coalesce(length(ua),            0) <= 300 and
    (duration_s is null or (duration_s >= 0 and duration_s <= 86400)) and
    pg_column_size(answers) <= 16000 and
    user_id is null and provider_id is null and claim_id is null and outcome is null
  );

-- ── Normalisers ──────────────────────────────────────────────────────────────
-- "Dra. María José López — Consultorio Dental" and "Maria Jose Lopez" should
-- meet. Titles and generic practice words carry no identity, so they go.
create or replace function public.bh_norm(t text)
returns text
language sql
stable
set search_path = public, extensions, pg_temp
as $$
    select btrim(regexp_replace(
        regexp_replace(
            regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g'),
            '\m(dr|dra|doctor|doctora|lic|mtro|mtra|clinica|clinicas|consultorio|centro|medico|medica|medicos|hospital|salud|grupo|especialidades|dental|dentista|odontologia|de|del|la|el|los|las|y|en|sa|cv|s|a|c|v|clinic|clinics|medical|center|centre|family|health|care|group|services|the|of|at|and|pllc|llc|pa|md|dds|inc)\M',
            ' ', 'g'),
        '\s+', ' ', 'g'));
$$;

-- Last ten digits: drops +52 / +1 / 01 prefixes on either side.
create or replace function public.bh_phone(t text)
returns text
language sql
immutable
as $$
    select nullif(right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 10), '');
$$;

-- ── Speed: normalise once, not per lookup ────────────────────────────────────
-- bh_norm per row per call made a lookup take ~3s over 4k listings. unaccent
-- is not immutable, so these cannot be generated columns; a trigger keeps them.
alter table public.providers
    add column if not exists name_norm  text,
    add column if not exists city_norm  text,
    add column if not exists phone_norm text;

create or replace function public.providers_norm_trg()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
    new.name_norm  := public.bh_norm(new.name);
    new.city_norm  := public.bh_norm(new.city);
    new.phone_norm := public.bh_phone(new.phone);
    return new;
end;
$$;

drop trigger if exists providers_norm on public.providers;
create trigger providers_norm
    before insert or update of name, city, phone on public.providers
    for each row execute function public.providers_norm_trg();

update public.providers
   set name_norm = public.bh_norm(name), city_norm = public.bh_norm(city), phone_norm = public.bh_phone(phone);

create index if not exists providers_name_norm_trgm
    on public.providers using gin (name_norm extensions.gin_trgm_ops);
create index if not exists providers_phone_norm_idx on public.providers (phone_norm);

-- ── Match ────────────────────────────────────────────────────────────────────
-- Everything returned is already public on the listing. Phone and email are
-- used to score, never returned, so this cannot be used to look them up.
create or replace function public.bh_match_providers(
    p_name  text,
    p_org   text,
    p_phone text default null,
    p_email text default null,
    p_city  text default null
)
returns table (
    id         uuid,
    name       text,
    address    text,
    city       text,
    country    text,
    specialty  text[],
    "imageUrl" text,
    owned      boolean,
    score      real,
    reasons    text[]
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
    -- materialized: otherwise the planner inlines q and re-runs unaccent on
    -- the query strings once per listing, which is most of the cost.
    with q as materialized (
        select nullif(public.bh_norm(p_name), '')  as n,
               nullif(public.bh_norm(p_org), '')   as o,
               case when length(public.bh_phone(p_phone)) >= 7 then public.bh_phone(p_phone) end as ph,
               nullif(lower(btrim(p_email)), '')    as em,
               public.bh_norm(p_city)                as c
    ),
    scored as (
        select p.*,
               (q.ph is not null and p.phone_norm = q.ph)          as m_phone,
               (q.em is not null and lower(btrim(p.email)) = q.em)             as m_email,
               -- Generic words are already gone (bh_norm), so what is compared is
               -- the distinctive part: "Pershing", "Maria Jose Lopez". The word
               -- form catches "Lopez" inside "Clinica Dental Lopez y Asociados",
               -- but only for a query long enough not to hit everything.
               greatest(
                   coalesce(extensions.similarity(p.name_norm, q.n), 0),
                   coalesce(extensions.similarity(p.name_norm, q.o), 0),
                   case when length(q.n) >= 5 then coalesce(extensions.strict_word_similarity(q.n, p.name_norm), 0) * 0.9 else 0 end,
                   case when length(q.o) >= 5 then coalesce(extensions.strict_word_similarity(q.o, p.name_norm), 0) * 0.9 else 0 end
               )                                                                as m_name,
               (q.c <> '' and p.city_norm <> '' and (p.city_norm like '%' || q.c || '%'
                               or q.c like '%' || p.city_norm || '%')) as m_city
        from public.providers p, q
        where p.status = 'live'
    ),
    ranked as (
        select s.id, s.name, s.address, s.city, s.country, s.specialty, s."imageUrl",
               exists (select 1 from public.provider_owners o where o.provider_id = s.id) as owned,
               (s.m_name
                 + case when s.m_phone then 1 else 0 end
                 + case when s.m_email then 1 else 0 end
                 + case when s.m_city  then 0.1 else 0 end)::real as score,
               array_remove(array[
                   case when s.m_phone then 'phone' end,
                   case when s.m_email then 'email' end,
                   case when s.m_name >= 0.5 then 'name' end,
                   case when s.m_city then 'city' end
               ], null) as reasons
        from scored s
        where s.m_phone or s.m_email or s.m_name >= 0.5
    ),
    -- The directory holds a few Google/Doctoralia duplicates of one clinic;
    -- show each place once, preferring a copy that is already owned.
    deduped as (
        select distinct on (lower(r.name), lower(r.address)) r.*
        from ranked r
        order by lower(r.name), lower(r.address), r.owned desc, r.score desc
    )
    select * from deduped
    order by score desc
    limit 5;
$$;

revoke all on function public.bh_match_providers(text, text, text, text, text) from public;
grant execute on function public.bh_match_providers(text, text, text, text, text) to anon, authenticated;

-- ── Claim ────────────────────────────────────────────────────────────────────
-- Instant ownership only when the signed-in account's *confirmed* email is the
-- email already on the listing: that is the one fact here nobody can type in.
-- A phone match is strong evidence but unverified (no SMS step), so it goes to
-- review with a note. A listing that already has an owner always goes to
-- review, so a claim can never silently add a second owner.
create or replace function public.bh_claim_provider(
    p_provider   uuid,
    p_submission uuid default null,
    p_evidence   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid       uuid := auth.uid();
    v_email     text;
    v_confirmed boolean;
    v_listing   public.providers%rowtype;
    v_resp      public.bh_responses%rowtype;
    v_has_owner boolean;
    v_auto      boolean := false;
    v_notes     text[] := '{}';
    v_evidence  text;
    v_claim     uuid;
begin
    if v_uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;

    select lower(email), email_confirmed_at is not null
      into v_email, v_confirmed
      from auth.users where id = v_uid;

    select * into v_listing from public.providers where id = p_provider and status = 'live';
    if not found then
        raise exception 'listing_not_found' using errcode = 'P0002';
    end if;

    if p_submission is not null then
        select * into v_resp from public.bh_responses
         where submission_key = p_submission and (user_id is null or user_id = v_uid);
    end if;

    select exists (select 1 from public.provider_owners where provider_id = p_provider)
      into v_has_owner;

    if exists (select 1 from public.provider_owners where provider_id = p_provider and user_id = v_uid) then
        return jsonb_build_object('status', 'owner', 'provider_id', p_provider);
    end if;

    if v_confirmed and v_email is not null and lower(btrim(v_listing.email)) = v_email then
        v_notes := array_append(v_notes, 'account email (confirmed) matches listing email');
        v_auto := not v_has_owner;
    end if;
    if v_resp.id is not null
       and length(public.bh_phone(v_resp.contact_phone)) >= 7
       and public.bh_phone(v_resp.contact_phone) = public.bh_phone(v_listing.phone) then
        v_notes := array_append(v_notes, 'survey phone matches listing phone (unverified)');
    end if;
    if v_has_owner then
        v_notes := array_append(v_notes, 'listing already has an owner');
    end if;

    v_evidence := left(concat_ws(E'\n',
        '[borderhealth] ' || coalesce(array_to_string(v_notes, '; '), ''),
        case when v_resp.id is not null then
            format('Survey #%s: %s / %s / %s / %s', v_resp.id, v_resp.contact_name,
                   v_resp.contact_org, v_resp.contact_email, v_resp.contact_phone) end,
        nullif(btrim(p_evidence), '')
    ), 2000);

    insert into public.provider_claims (provider_id, user_id, status, evidence, reviewed_at)
    values (p_provider, v_uid,
            case when v_auto then 'approved' else 'pending' end,
            v_evidence,
            case when v_auto then now() end)
    on conflict (provider_id, user_id) do update
        set evidence    = excluded.evidence,
            status      = case when provider_claims.status = 'approved' then 'approved' else excluded.status end,
            reviewed_at = coalesce(provider_claims.reviewed_at, excluded.reviewed_at)
    returning id into v_claim;

    if v_auto then
        insert into public.provider_owners (provider_id, user_id, role)
        values (p_provider, v_uid, 'owner')
        on conflict do nothing;
    end if;

    if v_resp.id is not null then
        update public.bh_responses
           set user_id = v_uid, provider_id = p_provider, claim_id = v_claim,
               outcome = case when v_auto then 'claimed' else 'claim_pending' end
         where id = v_resp.id;
    end if;

    return jsonb_build_object(
        'status', case when v_auto then 'approved' else 'pending' end,
        'claim_id', v_claim,
        'provider_id', p_provider
    );
end;
$$;

revoke all on function public.bh_claim_provider(uuid, uuid, text) from public;
grant execute on function public.bh_claim_provider(uuid, uuid, text) to authenticated;

-- ── New listing ──────────────────────────────────────────────────────────────
-- Created hidden (status 'pending') with the submitter as owner, so they can
-- fill it in from /dashboard while someone reviews it. Going live is:
--   update public.providers set status = 'live' where id = '<id>';
-- Coordinates fall back to the city centre when the browser could not geocode.
create or replace function public.bh_submit_listing(
    p_submission  uuid,
    p_name        text,
    p_specialty   text[],
    p_city        text,
    p_country     text,
    p_address     text default null,
    p_phone       text default null,
    p_email       text default null,
    p_website     text default null,
    p_description text default null,
    p_lat         double precision default null,
    p_lng         double precision default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid     uuid := auth.uid();
    v_country text := upper(coalesce(p_country, 'MX'));
    v_city    text := coalesce(nullif(btrim(p_city), ''), 'Ciudad Juárez');
    v_lat     double precision := p_lat;
    v_lng     double precision := p_lng;
    v_id      uuid;
    v_resp    bigint;
begin
    if v_uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if coalesce(length(btrim(p_name)), 0) < 3 or length(p_name) > 160 then
        raise exception 'bad_name' using errcode = '22023';
    end if;
    if v_country not in ('MX', 'US') then
        raise exception 'bad_country' using errcode = '22023';
    end if;
    if coalesce(array_length(p_specialty, 1), 0) = 0 then
        p_specialty := array['general'];
    end if;

    -- Three pending listings per account is plenty for a real group practice
    -- and stops a script from filling the review queue.
    if (select count(*) from public.providers p
          join public.provider_owners o on o.provider_id = p.id
         where o.user_id = v_uid and p.status = 'pending') >= 3 then
        raise exception 'too_many_pending' using errcode = '54000';
    end if;

    if v_lat is null or v_lng is null
       or v_lat not between 25 and 35 or v_lng not between -110 and -100 then
        select c.lat, c.lng into v_lat, v_lng from (values
            ('juarez',    31.6904, -106.4245),
            ('paso',      31.7619, -106.4850),   -- bh_norm drops "el"
            ('chihuahua', 28.6320, -106.0691)
        ) as c(k, lat, lng)
        where public.bh_norm(v_city) like '%' || c.k || '%'
        limit 1;
        v_lat := coalesce(v_lat, case when v_country = 'US' then 31.7619 else 31.6904 end);
        v_lng := coalesce(v_lng, case when v_country = 'US' then -106.4850 else -106.4245 end);
    end if;

    insert into public.providers (
        name, specialty, country, city, address, lat, lng,
        phone, email, website, description, source, status, updated_at, updated_by
    ) values (
        btrim(p_name), p_specialty, v_country, v_city,
        coalesce(nullif(btrim(left(p_address, 300)), ''), v_city),
        v_lat, v_lng,
        nullif(btrim(left(p_phone, 40)), ''), nullif(lower(btrim(left(p_email, 160))), ''),
        nullif(btrim(left(p_website, 300)), ''), nullif(btrim(left(p_description, 2000)), ''),
        'self', 'pending', now(), v_uid
    ) returning id into v_id;

    insert into public.provider_owners (provider_id, user_id, role) values (v_id, v_uid, 'owner');

    if p_submission is not null then
        update public.bh_responses
           set user_id = v_uid, provider_id = v_id, outcome = 'listing_pending'
         where submission_key = p_submission and (user_id is null or user_id = v_uid)
        returning id into v_resp;
    end if;

    return jsonb_build_object('status', 'pending', 'provider_id', v_id, 'response_id', v_resp);
end;
$$;

revoke all on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) from public;
grant execute on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) to authenticated;

-- ── Grants, tightened after the security advisor ─────────────────────────────
-- Supabase's default privileges hand EXECUTE to anon on every new function;
-- "revoke ... from public" above does not undo that. Claiming and listing
-- raise not_signed_in anyway, but they should not be reachable at all.
revoke execute on function public.bh_claim_provider(uuid, uuid, text) from anon;
revoke execute on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) from anon;
revoke execute on function public.providers_norm_trg() from anon, authenticated;
alter function public.bh_phone(text) set search_path = pg_temp;

-- ── Hardening after review ───────────────────────────────────────────────────
-- 1. bh_submit_listing is idempotent per survey submission. Confirming the
--    email in a new tab resumes the request there while the original tab also
--    sees the sign-in; a double click does the same. Both used to create two
--    listings. Now the survey row is locked and a second call returns the
--    listing the first one made. Without a submission key, the same person
--    submitting the same name again within ten minutes gets the same answer.
-- 2. Inputs clamped: city length, specialty keys limited to the directory's
--    own, website must be http(s).
create or replace function public.bh_submit_listing(
    p_submission  uuid,
    p_name        text,
    p_specialty   text[],
    p_city        text,
    p_country     text,
    p_address     text default null,
    p_phone       text default null,
    p_email       text default null,
    p_website     text default null,
    p_description text default null,
    p_lat         double precision default null,
    p_lng         double precision default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid     uuid := auth.uid();
    v_country text := upper(coalesce(p_country, 'MX'));
    v_city    text := coalesce(nullif(btrim(left(p_city, 80)), ''), 'Ciudad Juárez');
    v_lat     double precision := p_lat;
    v_lng     double precision := p_lng;
    v_spec    text[];
    v_site    text := nullif(btrim(left(p_website, 300)), '');
    v_id      uuid;
    v_resp    public.bh_responses%rowtype;
begin
    if v_uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if coalesce(length(btrim(p_name)), 0) < 3 or length(p_name) > 160 then
        raise exception 'bad_name' using errcode = '22023';
    end if;
    if v_country not in ('MX', 'US') then
        raise exception 'bad_country' using errcode = '22023';
    end if;

    -- Serialise this user's listing requests: the idempotency checks below
    -- and the pending cap are only race-free one at a time.
    perform pg_advisory_xact_lock(hashtext('bh_submit_listing:' || v_uid::text));

    if p_submission is not null then
        select * into v_resp from public.bh_responses
         where submission_key = p_submission
         for update;
        if v_resp.id is not null and v_resp.user_id is not null and v_resp.user_id <> v_uid then
            v_resp := null;   -- someone else's row; do not touch or reveal it
        end if;
        if v_resp.id is not null and v_resp.outcome = 'listing_pending' and v_resp.provider_id is not null then
            return jsonb_build_object('status', 'pending', 'provider_id', v_resp.provider_id,
                                      'response_id', v_resp.id, 'repeat', true);
        end if;
    end if;

    select p.id into v_id
      from public.providers p
      join public.provider_owners o on o.provider_id = p.id and o.user_id = v_uid
     where p.status = 'pending' and p.source = 'self'
       and p.name_norm = public.bh_norm(p_name)
       and p.updated_at > now() - interval '10 minutes'
     limit 1;
    if v_id is not null then
        if v_resp.id is not null then
            update public.bh_responses
               set user_id = v_uid, provider_id = v_id, outcome = 'listing_pending'
             where id = v_resp.id;
        end if;
        return jsonb_build_object('status', 'pending', 'provider_id', v_id,
                                  'response_id', v_resp.id, 'repeat', true);
    end if;

    if (select count(*) from public.providers p
          join public.provider_owners o on o.provider_id = p.id
         where o.user_id = v_uid and p.status = 'pending') >= 3 then
        raise exception 'too_many_pending' using errcode = '54000';
    end if;

    select coalesce(array_agg(distinct k), '{}') into v_spec
      from unnest(coalesce(p_specialty, '{}')) k
     where k in ('dentist', 'orthodontist', 'plastic_surgery', 'aesthetician', 'obgyn',
                 'physical_therapy', 'massage', 'optometry', 'general', 'pediatrics',
                 'cardiology', 'urgent_care', 'mental_health', 'pharmacy', 'telehealth');
    if coalesce(array_length(v_spec, 1), 0) = 0 then
        v_spec := array['general'];
    end if;
    v_spec := v_spec[1:5];

    if v_site is not null and v_site !~* '^https?://' then
        v_site := case when v_site ~* '^[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' then 'https://' || v_site end;
    end if;

    if v_lat is null or v_lng is null
       or v_lat not between 25 and 35 or v_lng not between -110 and -100 then
        v_lat := null; v_lng := null;
        select c.lat, c.lng into v_lat, v_lng from (values
            ('juarez',    31.6904, -106.4245),
            ('paso',      31.7619, -106.4850),   -- bh_norm drops "el"
            ('chihuahua', 28.6320, -106.0691)
        ) as c(k, lat, lng)
        where public.bh_norm(v_city) like '%' || c.k || '%'
        limit 1;
        v_lat := coalesce(v_lat, case when v_country = 'US' then 31.7619 else 31.6904 end);
        v_lng := coalesce(v_lng, case when v_country = 'US' then -106.4850 else -106.4245 end);
    end if;

    insert into public.providers (
        name, specialty, country, city, address, lat, lng,
        phone, email, website, description, source, status, updated_at, updated_by
    ) values (
        btrim(p_name), v_spec, v_country, v_city,
        coalesce(nullif(btrim(left(p_address, 300)), ''), v_city),
        v_lat, v_lng,
        nullif(btrim(left(p_phone, 40)), ''), nullif(lower(btrim(left(p_email, 160))), ''),
        v_site, nullif(btrim(left(p_description, 2000)), ''),
        'self', 'pending', now(), v_uid
    ) returning id into v_id;

    insert into public.provider_owners (provider_id, user_id, role) values (v_id, v_uid, 'owner');

    if v_resp.id is not null then
        update public.bh_responses
           set user_id = v_uid, provider_id = v_id, outcome = 'listing_pending'
         where id = v_resp.id;
    end if;

    return jsonb_build_object('status', 'pending', 'provider_id', v_id, 'response_id', v_resp.id);
end;
$$;

revoke all on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) to authenticated;

-- 3. A claim's status is decided by review or by bh_claim_provider, never by
--    the client. 0003 let an authenticated user INSERT every column, so they
--    could file their own claim as 'approved' (no ownership followed, but the
--    review queue showed a fake approval).
revoke insert on public.provider_claims from anon, authenticated;
grant insert (provider_id, user_id, evidence) on public.provider_claims to authenticated;

-- 4. Trigger functions cannot be called directly, but PUBLIC still held
--    EXECUTE; take it away so the advisor stops listing it.
revoke execute on function public.providers_norm_trg() from public;

-- Instant claims rely on Supabase Auth "Confirm email" staying ON: with it
-- off, email_confirmed_at is set at sign-up and anyone could register as a
-- listing's public email. Turning it off requires dropping the auto path in
-- bh_claim_provider first.
