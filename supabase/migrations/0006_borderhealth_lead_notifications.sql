-- Team notifications for self-serve onboarding.
--
-- "Get listed free" used to insert into public.leads, and the Supabase webhook
-- on that table (api/lead-notify.ts) emailed the team. The form now creates a
-- pending listing (bh_submit_listing) or a pending claim (bh_claim_provider)
-- instead, so those two events write a leads row themselves. Same table, same
-- webhook, same email; the message carries the SQL to approve it.
--
-- Already applied to the live project (gbfbsecjgjmqoznebwwb).

create or replace function public.bh_notify_new_listing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_email text;
begin
    if new.source <> 'self' or new.status <> 'pending' then return new; end if;
    select email into v_email from auth.users where id = new.updated_by;
    insert into public.leads (clinic, contact, email, phone, specialty, city, message, locale, plan)
    values (
        left(new.name, 200),
        left(coalesce(v_email, new.email, 'unknown'), 200),
        left(coalesce(new.email, v_email, 'unknown@unknown'), 320),
        left(new.phone, 40),
        left(new.specialty[1], 60),
        left(new.city, 120),
        left(format(E'Self-serve listing pending review.\nprovider_id: %s\nSurvey answers: bh_responses where provider_id = ''%s''\nApprove: update providers set status = ''live'' where id = ''%s'';',
                    new.id, new.id, new.id), 2000),
        null,
        'free-listing'
    );
    return new;
end;
$$;

drop trigger if exists providers_notify_new_listing on public.providers;
create trigger providers_notify_new_listing
    after insert on public.providers
    for each row execute function public.bh_notify_new_listing();

-- INSERT only: bh_claim_provider upserts, and a resubmitted claim takes the
-- ON CONFLICT DO UPDATE path, which must not email the team a second time.
create or replace function public.bh_notify_new_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_email text; v_name text; v_phone text;
begin
    if new.status <> 'pending' then return new; end if;
    select email into v_email from auth.users where id = new.user_id;
    select name, phone into v_name, v_phone from public.providers where id = new.provider_id;
    insert into public.leads (clinic, contact, email, phone, message, plan)
    values (
        left(coalesce(v_name, 'unknown listing'), 200),
        left(coalesce(v_email, 'unknown'), 200),
        left(coalesce(v_email, 'unknown@unknown'), 320),
        left(v_phone, 40),
        left(format(E'Claim request awaiting review.\nprovider_id: %s\nclaim_id: %s\nEvidence: %s\nApprove: update provider_claims set status = ''approved'', reviewed_at = now() where id = ''%s''; insert into provider_owners (provider_id, user_id) values (''%s'', ''%s'');',
                    new.provider_id, new.id, coalesce(new.evidence, ''), new.id, new.provider_id, new.user_id), 2000),
        'claim'
    );
    return new;
end;
$$;

drop trigger if exists provider_claims_notify_new on public.provider_claims;
create trigger provider_claims_notify_new
    after insert on public.provider_claims
    for each row execute function public.bh_notify_new_claim();

revoke execute on function public.bh_notify_new_listing() from public, anon, authenticated;
revoke execute on function public.bh_notify_new_claim() from public, anon, authenticated;
