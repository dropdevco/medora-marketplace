-- Exact review search, made cheap: half-precision vectors stored in the row.
--
-- History: HNSW (0013) missed close matches; exact search (0016) found them
-- but timed out under load; HNSW with ef_search = 200 + iterative scan (0017)
-- was fast but still missed "consulta por dolor de cabeza" for "Me duele la
-- cabeza". Review similarities sit in a narrow band (~0.40-0.46), which is
-- where approximate search is least reliable. So: exact, but fast.
--
-- The exact scan was slow because a vector(1024) is 4 KB and lives in TOAST, so
-- every query fetched ~6.7k out-of-line values. halfvec(1024) is ~2 KB and
-- STORAGE PLAIN keeps it in the heap row: one sequential pass, no TOAST hops.
-- Half precision is ample for ranking by cosine similarity.

drop index if exists public.review_embeddings_embedding_idx;

alter table public.review_embeddings add column embedding_half extensions.halfvec(1024);
-- Must be set before the values are written: storage applies to new tuples.
alter table public.review_embeddings alter column embedding_half set storage plain;
update public.review_embeddings set embedding_half = embedding::extensions.halfvec(1024) where embedding is not null;

alter table public.review_embeddings drop column embedding;
alter table public.review_embeddings rename column embedding_half to embedding;

drop function if exists public.match_reviews(extensions.vector, int);

create function public.match_reviews(
    query_embedding extensions.vector(1024),
    match_count     int default 40
)
returns table (
    review_id   uuid,
    provider_id uuid,
    body        text,
    body_es     text,
    body_en     text,
    source_lang text,
    rating      numeric,
    symptoms    text[],
    outcome     text,
    similarity  double precision
)
language sql stable
set search_path = public, extensions
as $$
    select e.review_id, e.provider_id, r.body, e.body_es, e.body_en, e.source_lang,
           r.rating, e.symptoms, e.outcome,
           1 - (e.embedding <=> query_embedding::halfvec(1024)) as similarity
    from public.review_embeddings e
    join public.doctoralia_reviews r on r.id = e.review_id
    where e.provider_id is not null and e.embedding is not null
    order by e.embedding <=> query_embedding::halfvec(1024)
    limit least(match_count, 200);
$$;

revoke all on function public.match_reviews(extensions.vector, int) from public, anon, authenticated;
