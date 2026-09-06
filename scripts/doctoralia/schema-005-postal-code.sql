-- Postal / ZIP code as a first-class column on providers.
--
-- The code is already present inside the free-text `address` for ~99% of rows,
-- but in four different shapes depending on which ingestion path wrote it.
-- Parsing it on every keystroke in the browser would be wasteful and would also
-- over-match street numbers, so it gets extracted once by backfill-postal.ts.

alter table public.providers
  add column if not exists "postalCode" text;

create index if not exists providers_postal_code_idx
  on public.providers ("postalCode")
  where "postalCode" is not null;
