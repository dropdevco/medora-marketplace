-- Nearest reviews to a query embedding, for AI symptom search (api/ai-search.ts).
--
-- Only reviews of live listings come back (provider_id not null). Similarity is
-- 1 - cosine distance, so 1 = same meaning; callers threshold on it. Service role
-- only, like the table it reads.

create or replace function public.match_reviews(
    query_embedding extensions.vector(1024),
    match_count     int default 40
)
returns table (
    review_id   uuid,
    provider_id uuid,
    body        text,
    rating      numeric,
    symptoms    text[],
    outcome     text,
    similarity  double precision
)
language sql stable
set search_path = public, extensions
as $$
    select e.review_id, e.provider_id, r.body, r.rating, e.symptoms, e.outcome,
           1 - (e.embedding <=> query_embedding) as similarity
    from public.review_embeddings e
    join public.doctoralia_reviews r on r.id = e.review_id
    where e.provider_id is not null and e.embedding is not null
    order by e.embedding <=> query_embedding
    limit least(match_count, 200);
$$;

revoke all on function public.match_reviews(extensions.vector, int) from public, anon, authenticated;
