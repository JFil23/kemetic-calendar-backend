-- Retire the obsolete Medu Neter generator / translator stack.
-- Decision-matrix quality logic now lives in the graph-aware flow/reflection pipeline.

drop table if exists public.medu_decision_matrix;
drop table if exists public.medu_kg_edges;
drop table if exists public.memory_nodes;
drop table if exists public.medu_dictionary;
