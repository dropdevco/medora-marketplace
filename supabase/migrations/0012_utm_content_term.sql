-- utm_content / utm_term (audience-lang tag and email A/B version) in the reports.
-- Appended at the end so dependent views stay valid.

create or replace view public.form_visits as
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
    extract(epoch from max(e.created_at) - min(e.created_at))::int        as seconds_on_page,
    (array_agg(e.utm_content order by e.created_at) filter (where e.utm_content is not null))[1]                          as utm_content,
    (array_agg(e.utm_term order by e.created_at) filter (where e.utm_term is not null))[1]                                as utm_term
from e
group by e.visit_id;


create or replace view public.form_by_source as
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
    count(*) filter (where v.submitted)::int as submissions,
    coalesce(v.utm_medium, '')               as utm_medium,
    coalesce(v.utm_content, '')              as utm_content,
    coalesce(v.utm_term, '')                 as utm_term
from public.form_visits v
group by 1, 2, 3, 4, 5, 6, 7, 12, 13, 14;


revoke all on public.form_visits, public.form_by_source from anon, authenticated;
