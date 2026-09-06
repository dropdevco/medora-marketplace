-- Published services and prices as first-class provider columns.
--
-- The data already sits in `doctoralia_services`, but that table is staging:
-- RLS is on with no policies, so the anon browser client cannot read it. Rather
-- than open a staging table to the public, the rows are denormalised onto
-- `providers` — the same shape schema-004 used for `insurances`.
--
-- `priceFromMxn` duplicates the cheapest price out of the jsonb so that sorting
-- and filtering by price never has to walk an array. It is null for the roughly
-- two thirds of providers that publish no price at all, which is why the UI
-- treats "publishes prices" as an opt-in filter rather than a silent default.
--
-- Populated by scripts/doctoralia/backfill-services.ts.

alter table public.providers
  add column if not exists services jsonb not null default '[]'::jsonb,
  add column if not exists "priceFromMxn" numeric(10,2);

-- Partial: the index only needs to serve the priced subset, which is the only
-- one a price filter can ever return.
create index if not exists providers_price_from_idx
  on public.providers ("priceFromMxn")
  where "priceFromMxn" is not null;
