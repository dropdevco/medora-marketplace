-- CSV export of every MedSociety contact.
--
-- Download: Supabase dashboard -> Table Editor -> pick the view
-- "contacts_export" -> Export -> Download as CSV (or SQL editor:
-- `select * from contacts_export` -> Download CSV).
--
-- Columns: title, first_name, last_name, phone, email, country (US / Mexico),
-- plus organization/source/city for context.
--
-- Sources: directory listings (providers) that have a phone or email, clinic
-- leads, and /borderhealth survey contacts.
--
-- Names: directory listings are scraped business names ("Dr. Misael Hernandez
-- Acosta | Medico Internista en Juarez"), so a person is only parsed when the
-- name starts with Dr./Dra./Doctor. Title is Señor for Dr., Señora for Dra.;
-- anything else is left blank rather than guessed from a first name.
-- Country comes from the phone prefix (+1 = US, +52 = Mexico) because the
-- providers.country column is wrong for some rows; it falls back to that column.
--
-- Contains personal data: not readable by anon/authenticated, only by the
-- dashboard / service role.

create or replace view public.contacts_export
with (security_invoker = true)
as
with prov as (
    select p.name as organization,
           -- person part: drop title, cut at the first separator
           btrim(regexp_replace(
               split_part(split_part(split_part(split_part(
                   regexp_replace(p.name, '^(dra?|doctora?)\.?\s+', '', 'i'),
                   ' - ', 1), ' | ', 1), ' ¦ ', 1), ',', 1),
               '\s+', ' ', 'g')) as person,
           (p.name ~* '^(dr|doctor)\.?\s')  as is_dr,
           (p.name ~* '^(dra|doctora)\.?\s') as is_dra,
           p.phone, p.email, p.country, p.city, 'directory'::text as source
    from public.providers p
    where p.status = 'live'
      and (coalesce(p.phone, '') <> '' or coalesce(p.email, '') <> '')
),
allc as (
    select case when is_dra then 'Señora' when is_dr then 'Señor' end as title,
           case when is_dr or is_dra then split_part(person, ' ', 1) end as first_name,
           case when (is_dr or is_dra) and position(' ' in person) > 0
                then substr(person, position(' ' in person) + 1) end as last_name,
           phone, email, country, organization, city, source
    from prov
    union all
    select null,
           split_part(btrim(l.contact), ' ', 1),
           case when position(' ' in btrim(l.contact)) > 0
                then substr(btrim(l.contact), position(' ' in btrim(l.contact)) + 1) end,
           l.phone, l.email, null, l.clinic, l.city, 'lead'
    from public.leads l
    union all
    select null,
           split_part(btrim(coalesce(r.contact_name, '')), ' ', 1),
           case when position(' ' in btrim(coalesce(r.contact_name, ''))) > 0
                then substr(btrim(r.contact_name), position(' ' in btrim(r.contact_name)) + 1) end,
           r.contact_phone, r.contact_email, null, r.contact_org, r.city, 'borderhealth_survey'
    from public.bh_responses r
    where coalesce(r.contact_phone, '') <> '' or coalesce(r.contact_email, '') <> ''
)
select title,
       nullif(first_name, '') as first_name,
       last_name,
       nullif(btrim(phone), '') as phone,
       nullif(lower(btrim(email)), '') as email,
       case
           when regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '52%' then 'Mexico'
           when regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '1%'  then 'U.S.'
           when upper(coalesce(country, '')) = 'MX' or city ~* 'ju[aá]rez|chihuahua' then 'Mexico'
           when upper(coalesce(country, '')) = 'US' or city ~* 'el paso' then 'U.S.'
       end as country,
       organization,
       city,
       source
from allc
order by source, organization;

revoke all on public.contacts_export from anon, authenticated;
