-- Vector search over the reviews we already hold (AI symptom search, step 1).
--
-- Nothing existing changes: pgvector adds a column type, and this table sits
-- beside doctoralia_reviews with one row per review. The batch job (step 2)
-- fills `embedding`, `symptoms` and `outcome`; the search endpoint (step 3)
-- reads it with the service role and joins to providers for name/location.
--
-- 1024 dimensions fits both voyage-3.5 and OpenAI text-embedding-3 (via its
-- `dimensions` parameter), so the provider can be picked without a re-migration.
-- `model` records which one produced each vector; vectors from different models
-- are not comparable, so a model switch means re-embedding every row.

create extension if not exists vector with schema extensions;

create table if not exists public.review_embeddings (
    review_id     uuid primary key references public.doctoralia_reviews(id) on delete cascade,
    doctoralia_id text not null references public.doctoralia_doctors(doctoralia_id) on delete cascade,
    -- Denormalised from doctoralia_doctors.provider_id so a search is one join, not two.
    -- Null = the doctor is not (yet) a listing; such rows are skipped at query time.
    provider_id   uuid references public.providers(id) on delete set null,

    embedding     extensions.vector(1024),
    model         text,
    -- md5 of the review body as embedded; a mismatch means the text changed and needs re-embedding.
    content_hash  text,

    -- Normalised, bilingual symptom/condition tags, e.g. {'ear pain','dolor de oído'}.
    symptoms      text[] not null default '{}',
    outcome       text check (outcome in ('resolved', 'improved', 'not_helped', 'unclear')),

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists review_embeddings_provider_idx on public.review_embeddings (provider_id);
create index if not exists review_embeddings_symptoms_idx on public.review_embeddings using gin (symptoms);
-- Cosine distance: what both candidate embedding models are trained for.
create index if not exists review_embeddings_embedding_idx
    on public.review_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- Same posture as the doctoralia_* staging tables: service role only.
alter table public.review_embeddings enable row level security;
revoke all on public.review_embeddings from anon, authenticated;
