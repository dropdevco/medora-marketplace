-- The same survey now lives at two URLs: /borderhealth (MedSociety-branded,
-- feeds the provider listing flow) and /research (MLCIC + NSF I-Corps branded
-- study). Every report is split by that slug so the two never blur together.
--
--   form_events.form_slug   generated from page_path, so old rows backfill themselves
--   bh_responses.form_slug  stamped by the client on submit; legacy rows = 'borderhealth'
--
-- The views from 0010 are dropped and rebuilt with form_slug as a column.

alter table public.form_events
    add column if not exists form_slug text
    generated always as (nullif(split_part(page_path, '/', 2), '')) stored;

alter table public.bh_responses
    add column if not exists form_slug text not null default 'borderhealth';

drop view if exists public.form_visitors, public.form_audience, public.form_daily,
                    public.form_by_source, public.form_step_funnel, public.form_summary,
                    public.form_visits;

create view public.form_visits as
with e as (
    select * from public.form_events
    where session = 'live' and not is_bot and visit_id is not null
)
select
    e.visit_id,
    coalesce(min(e.form_slug), 'borderhealth')                            as form_slug,
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

create view public.form_summary as
select
    v.form_slug,
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
      where r.form_slug = v.form_slug and r.segment = v.form_segment and r.lang = v.lang and r.session = 'live')::int as responses_on_record
from public.form_visits v
group by v.form_slug, v.form_segment, v.lang;

create view public.form_step_funnel as
select
    coalesce(e.form_slug, 'borderhealth')                               as form_slug,
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
group by coalesce(e.form_slug, 'borderhealth'), e.form_segment, e.lang, e.step, e.step_id;

create view public.form_by_source as
select
    v.form_slug,
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
group by 1, 2, 3, 4, 5, 6, 7;

create view public.form_daily as
select
    (v.first_seen at time zone 'America/Denver')::date as day,
    v.form_slug,
    v.form_segment,
    v.lang,
    sum(v.page_views)::int                   as page_opens,
    count(*)::int                            as visits,
    count(distinct v.visitor_id)::int        as unique_visitors,
    count(*) filter (where v.started)::int   as started,
    count(*) filter (where v.submitted)::int as submissions
from public.form_visits v
group by 1, 2, 3, 4;

create view public.form_audience as
select
    v.form_slug,
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
group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

create view public.form_visitors as
select
    v.visitor_id,
    min(v.first_seen)                         as first_seen,
    max(v.last_seen)                          as last_seen,
    count(*)::int                             as visits,
    sum(v.page_views)::int                    as page_opens,
    array_agg(distinct v.form_slug)           as slugs_seen,
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

revoke all on public.form_visits, public.form_summary, public.form_step_funnel,
              public.form_by_source, public.form_daily, public.form_audience,
              public.form_visitors from anon, authenticated;
