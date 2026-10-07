-- Exact nearest-review search instead of the HNSW index from 0013.
--
-- HNSW is approximate and, at the default hnsw.ef_search = 40, returns at most
-- ~40 rows no matter the LIMIT. match_reviews asked for 40-200 and got 41, and
-- "Me duele la cabeza" never surfaced the one review that says "fui a consulta
-- por dolor de cabeza". At ~7k rows an exact scan is a few milliseconds, and
-- the index also made every tag/translation write slow enough to time out.
-- Re-add an index (with a raised ef_search) if this table passes ~100k rows.

drop index if exists public.review_embeddings_embedding_idx;
