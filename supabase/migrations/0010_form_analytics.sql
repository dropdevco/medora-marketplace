-- Form analytics for /borderhealth (employer / employee / provider, EN + ES).
--
-- bh_responses only knows about people who FINISHED a form. This adds the rest
-- of the funnel: who opened it, how many times, where they came from, how far
-- they got, where they quit, and whether they submitted.
--
-- Events are written by api/form-event.ts with the service role (it adds
-- country / region / city from Vercel's edge headers and a salted IP hash).
-- The table has RLS on and NO policies, so the browser cannot read or write it.
--
-- Read it with the views at the bottom, from the Supabase SQL editor or
--   npx tsx --env-file=.env.local scripts/form-stats.ts
--
-- Run in: Supabase dashboard -> SQL editor (or apply_migration).

create table if not exists public.form_events (
    id            bigint generated always as identity primary key,
    created_at    timestamptz not null default now(),

    -- what happened
    event         text not null check (event in (
                      'page_view', 'segment_selected', 'segment_changed', 'step_view',
                      'first_answer', 'step_next', 'validation_error', 'lang_switch',
                      'submit_attempt', 'submit_success', 'submit_error', 'abandon')),
    form_segment  text check (form_segment in ('employer', 'employee', 'provider')),
    lang          text check (lang in ('en', 'es')),
    step          int,
    step_id       text,
    submission_key uuid,
    props         jsonb not null default '{}'::jsonb,

    -- who (anonymous until they submit: join bh_responses on client_id)
    visitor_id    text,   -- per browser, persists (localStorage bh_cid)
    visit_id      text,   -- per tab session (sessionStorage)

    -- how they got here
    session       text not null default 'live',   -- ?session=test keeps dry runs out
    ref           text,                           -- ?by= / ?ref= (who shared the link)
    page_path     text,
    page_query    text,
    referrer      text,
    referrer_host text,
    utm_source    text,
    utm_medium    text,
    utm_campaign  text,
    utm_content   text,
    utm_term      text,

    -- device (client-reported on page_view; ua and geo are stamped server-side)
    ua            text,
    device_type   text,
    browser       text,
    os            text,
    screen_w      int,
    screen_h      int,
    viewport_w    int,
    viewport_h    int,
    dpr           numeric,
    tz            text,
    browser_lang  text,
    connection    text,

    -- where (from Vercel edge headers) and a hash, never the raw IP
    country       text,
    region        text,
    city          text,
    ip_hash       text,
    is_bot        boolean not null default false
);

create index if not exists form_events_created_idx on public.form_events (created_at desc);
create index if not exists form_events_visit_idx   on public.form_events (visit_id);
create index if not exists form_events_visitor_idx on public.form_events (visitor_id);
create index if not exists form_events_form_idx    on public.form_events (form_segment, lang, event);

alter table public.form_events enable row level security;
revoke all on public.form_events from anon, authenticated;

-- ── One row per visit ────────────────────────────────────────────────────────
-- A visit is one tab session (visit_id). Test sessions and bots are excluded;
-- the raw table still has them. `opened` and `started` differ on purpose:
-- opened = saw the form, started = answered at least one question.
create or replace view public.form_visits as
with e as (
    select * from public.form_events
    where session = 'live' and not is_bot and visit_id is not null
)
select
    e.visit_id,
    min(e.visitor_id)                                                     as visitor_id,
    min(e.created_at)                                                     as first_seen,
    max(e.created_at)                                                     as last_seen,
    coalesce((array_agg(e.form_segment order by e.created_at desc) filter (where e.form_segment is not null))[1], 'chooser') as form_segment,
    (array_agg(e.lang order by e.created_at desc) filter (where e.lang is not null))[1]                                   as lang,
    (array_agg(e.ref order by e.created_at) filter (where e.ref is not null))[1]                                          as ref,
    (array_agg(e.referrer_host order by e.created_at) filter (where e.event = 'page_view'))[1]                            as referrer_host,
    (array_agg(e.utm_source order by e.created_at) filter (where e.utm_source is not null))[1]                            as utm_source,
    (array_agg(e.utm_medium order by e.created_at) filter (where e.utm_medium is not null))[1]                            as utm_medium,
    (array_agg(e.utm_campaign order by e.created_at) filter (where e.utm_campaign is not null))[1]                        as utm_campaign,
    (array_agg(e.device_type order by e.created_at) filter (where e.device_type is not null))[1]                          as device_type,
    (array_agg(e.browser order by e.created_at) filter (where e.browser is not null))[1]                                  as browser,
    (array_agg(e.os order by e.created_at) filter (where e.os is not null))[1]                                            as os,
    (array_agg(e.country order by e.created_at) filter (where e.country is not null))[1]                                  as country,
    (array_agg(e.region order by e.created_at) filter (where e.region is not null))[1]                                    as region,
    (array_agg(e.city order by e.created_at) filter (where e.city is not null))[1]                                        as city,
    (array_agg(e.ip_hash order by e.created_at) filter (where e.ip_hash is not null))[1]                                  as ip_hash,
    count(*) filter (where e.event = 'page_view')                         as page_views,
    bool_or(e.event = 'page_view')                                        as opened,
    bool_or(e.event = 'first_answer')                                     as started,
    coalesce(max(e.step) filter (where e.event = 'step_view'), 0) + 1     as furthest_screen,
    count(*) filter (where e.event = 'validation_error')                  as validation_errors,
    bool_or(e.event = 'submit_error')                                     as had_send_error,
    bool_or(e.event = 'submit_success')                                   as submitted,
    bool_or(e.event = 'first_answer') and not bool_or(e.event = 'submit_success') as abandoned,
    (array_agg(e.submission_key order by e.created_at desc) filter (where e.event = 'submit_success'))[1] as submission_key,
    extract(epoch from max(e.created_at) - min(e.created_at))::int        as seconds_on_page
from e
group by e.visit_id;

-- ── Headline numbers per form (the six URLs) ─────────────────────────────────
create or replace view public.form_summary as
select
    v.form_segment,
    v.lang,
    sum(v.page_views)::int                                             as page_opens,
    count(*)::int                                                      as visits,
    count(distinct v.visitor_id)::int                                  as unique_visitors,
    count(*) filter (where v.started)::int                             as started,
    count(*) filter (where v.submitted)::int                           as submissions,
    count(*) filter (where v.abandoned)::int                           as abandoned,
    round(100.0 * count(*) filter (where v.started)   / nullif(count(*), 0), 1) as start_rate_pct,
    round(100.0 * count(*) filter (where v.submitted) / nullif(count(*), 0), 1) as submit_rate_pct,
    round(100.0 * count(*) filter (where v.submitted) / nullif(count(*) filter (where v.started), 0), 1) as completion_of_started_pct,
    round(avg(v.seconds_on_page) filter (where v.submitted))::int      as avg_seconds_to_submit,
    count(*) filter (where v.had_send_error)::int                      as visits_with_send_error,
    max(v.last_seen)                                                   as last_activity,
    (select count(*) from public.bh_responses r
      where r.segment = v.form_segment and r.lang = v.lang and r.session = 'live')::int as responses_on_record
from public.form_visits v
group by v.form_segment, v.lang;

-- ── Where people quit, screen by screen ──────────────────────────────────────
create or replace view public.form_step_funnel as
select
    e.form_segment,
    e.lang,
    e.step + 1                                                          as screen_no,
    e.step_id,
    count(distinct e.visit_id) filter (where e.event = 'step_view')     as visits_reached,
    count(distinct e.visit_id) filter (where e.event = 'step_next')     as visits_passed,
    count(*) filter (where e.event = 'validation_error')                as validation_errors,
    round(avg((e.props ->> 'ms_on_step')::numeric) filter (where e.event = 'step_next') / 1000, 1) as avg_seconds_on_screen
from public.form_events e
where e.session = 'live' and not e.is_bot and e.form_segment is not null and e.step is not null
  and e.event in ('step_view', 'step_next', 'validation_error')
group by e.form_segment, e.lang, e.step, e.step_id;

-- ── Which link / person / site brought them ──────────────────────────────────
create or replace view public.form_by_source as
select
    v.form_segment,
    v.lang,
    coalesce(v.ref, 'link')                  as ref,
    coalesce(v.utm_source, '')               as utm_source,
    coalesce(v.utm_campaign, '')             as utm_campaign,
    coalesce(v.referrer_host, '')            as referrer_host,
    count(*)::int                            as visits,
    count(distinct v.visitor_id)::int        as unique_visitors,
    count(*) filter (where v.started)::int   as started,
    count(*) filter (where v.submitted)::int as submissions
from public.form_visits v
group by 1, 2, 3, 4, 5, 6;

-- ── Per day ──────────────────────────────────────────────────────────────────
create or replace view public.form_daily as
select
    (v.first_seen at time zone 'America/Denver')::date as day,
    v.form_segment,
    v.lang,
    sum(v.page_views)::int                   as page_opens,
    count(*)::int                            as visits,
    count(distinct v.visitor_id)::int        as unique_visitors,
    count(*) filter (where v.started)::int   as started,
    count(*) filter (where v.submitted)::int as submissions
from public.form_visits v
group by 1, 2, 3;

-- ── Devices and places ───────────────────────────────────────────────────────
create or replace view public.form_audience as
select
    v.form_segment,
    v.lang,
    coalesce(v.country, '?')      as country,
    coalesce(v.region, '')        as region,
    coalesce(v.city, '')          as city,
    coalesce(v.device_type, '?')  as device_type,
    coalesce(v.os, '?')           as os,
    coalesce(v.browser, '?')      as browser,
    count(*)::int                            as visits,
    count(*) filter (where v.submitted)::int as submissions
from public.form_visits v
group by 1, 2, 3, 4, 5, 6, 7, 8;

-- ── Who: one row per browser, with the contact details once they submit ──────
-- Anonymous until a submission carries the same client_id (bh_responses.client_id
-- is the same localStorage id as form_events.visitor_id). Contains personal data.
create or replace view public.form_visitors as
select
    v.visitor_id,
    min(v.first_seen)                         as first_seen,
    max(v.last_seen)                          as last_seen,
    count(*)::int                             as visits,
    sum(v.page_views)::int                    as page_opens,
    array_agg(distinct v.form_segment)        as forms_seen,
    array_agg(distinct v.lang)                as languages,
    count(*) filter (where v.submitted)::int  as submissions,
    (array_agg(v.country order by v.last_seen desc))[1]     as country,
    (array_agg(v.city order by v.last_seen desc))[1]        as city,
    (array_agg(v.device_type order by v.last_seen desc))[1] as device_type,
    (array_agg(v.ref order by v.first_seen) filter (where v.ref is not null))[1] as first_ref,
    c.contact_name,
    c.contact_org,
    c.contact_email,
    c.contact_phone
from public.form_visits v
left join lateral (
    select r.contact_name, r.contact_org, r.contact_email, r.contact_phone
    from public.bh_responses r
    where r.client_id = v.visitor_id and r.session = 'live'
    order by r.created_at desc
    limit 1
) c on true
group by v.visitor_id, c.contact_name, c.contact_org, c.contact_email, c.contact_phone;

-- Views run as their owner and would otherwise hand the table's data to anon.
revoke all on public.form_visits, public.form_summary, public.form_step_funnel,
              public.form_by_source, public.form_daily, public.form_audience,
              public.form_visitors from anon, authenticated;
