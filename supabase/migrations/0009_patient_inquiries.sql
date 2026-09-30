-- Patient questions/requests submitted from a provider page.
--
-- Online booking (Doctoralia link) was removed: a patient now sends us a
-- question, we store it here, email the team (api/inquiry.ts), and contact the
-- clinic on the patient's behalf.
--
-- Safer than the public.leads pattern on purpose: leads allows anonymous
-- INSERT via the anon key, which would let anyone bypass the honeypot, rate
-- limit and validation in the API. Here RLS is enabled with NO policies, so
-- anon/authenticated can neither read nor write. Only the service role
-- (used server-side by api/inquiry.ts, bypasses RLS) can insert or read.

create table if not exists public.patient_inquiries (
    id             uuid primary key default gen_random_uuid(),
    created_at     timestamptz not null default now(),
    provider_id    uuid,   -- reference to providers.id; deliberately no FK so a removed listing keeps its history
    provider_name  text check (char_length(provider_name) <= 200),
    patient_name   text not null check (char_length(patient_name) between 1 and 120),
    contact        text not null check (char_length(contact) between 3 and 200),
    contact_kind   text check (contact_kind in ('phone', 'email')),
    message        text not null check (char_length(message) between 1 and 2000),
    preferred_time text check (char_length(preferred_time) <= 40),
    language       text check (language in ('en', 'es')),
    source_url     text check (char_length(source_url) <= 500),
    status         text not null default 'new'
                   check (status in ('new', 'contacted', 'closed')),
    notes          text
);

create index if not exists patient_inquiries_created_at_idx on public.patient_inquiries (created_at desc);
create index if not exists patient_inquiries_status_idx     on public.patient_inquiries (status);

alter table public.patient_inquiries enable row level security;
-- Intentionally no policies: not readable or writable with the anon key.
revoke all on public.patient_inquiries from anon, authenticated;
