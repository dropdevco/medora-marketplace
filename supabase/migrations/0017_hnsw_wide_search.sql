-- Back to an HNSW index, but searched wide enough to not miss matches.
--
-- 0016 swapped HNSW for an exact scan. Correct, but the scan detoasts every
-- 1024-dim vector per query, and on this instance that ranged from 0.3 s to
-- past the statement timeout. The original miss was HNSW's default
-- ef_search = 40, which caps a query at ~40 candidates. match_reviews now sets
-- ef_search = 200 for itself (≥ the most it ever asks for) and lets pgvector
-- keep scanning when the provider filter drops rows (iterative_scan).
--
-- Bulk rewrites of the table (re-tag, re-translate) are slower with the index
-- in place; for a full re-run, drop it first and re-create it afterwards.

create index if not exists review_embeddings_embedding_idx
    on public.review_embeddings using hnsw (embedding extensions.vector_cosine_ops);

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
set hnsw.ef_search = 200
set hnsw.iterative_scan = relaxed_order
as $$
    select e.review_id, e.provider_id, r.body, e.body_es, e.body_en, e.source_lang,
           r.rating, e.symptoms, e.outcome,
           1 - (e.embedding <=> query_embedding) as similarity
    from public.review_embeddings e
    join public.doctoralia_reviews r on r.id = e.review_id
    where e.provider_id is not null and e.embedding is not null
    order by e.embedding <=> query_embedding
    limit least(match_count, 200);
$$;

revoke all on function public.match_reviews(extensions.vector, int) from public, anon, authenticated;
