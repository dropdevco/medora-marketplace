-- Reviews in both site languages, for the AI search quotes.
--
-- Filled once by `scripts/reviews/enrich.ts translate` (Claude Haiku via
-- OpenRouter). Both columns are always set: the one in the review's own
-- language holds the original text verbatim, the other the translation, so the
-- endpoint picks by site language and flags a quote as translated when
-- source_lang differs.

alter table public.review_embeddings
    add column if not exists source_lang text check (source_lang in ('es', 'en')),
    add column if not exists body_es     text,
    add column if not exists body_en     text;

-- The return type changes, which `create or replace` cannot do.
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
           1 - (e.embedding <=> query_embedding) as similarity
    from public.review_embeddings e
    join public.doctoralia_reviews r on r.id = e.review_id
    where e.provider_id is not null and e.embedding is not null
    order by e.embedding <=> query_embedding
    limit least(match_count, 200);
$$;

revoke all on function public.match_reviews(extensions.vector, int) from public, anon, authenticated;
