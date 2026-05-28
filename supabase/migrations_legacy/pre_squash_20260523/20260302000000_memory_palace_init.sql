-- Memory Palace Phase 1: core tables + seed

-- 1. The Core Schema (Source of Truth)
CREATE TABLE IF NOT EXISTS medu_dictionary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gardiner_code TEXT NOT NULL,
    unicode_char TEXT,
    transliteration TEXT,
    english_glosses TEXT[] NOT NULL,
    semantic_tags TEXT[],
    is_visual_anchor BOOLEAN DEFAULT FALSE,
    is_logogram BOOLEAN DEFAULT FALSE
);

-- 2. The Knowledge Graph (Edges)
CREATE TABLE IF NOT EXISTS medu_kg_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_concept TEXT NOT NULL,
    target_dict_id UUID REFERENCES medu_dictionary(id),
    relationship_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0
);

-- 3. The Decision Matrix (User Preferences)
CREATE TABLE IF NOT EXISTS medu_decision_matrix (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    dict_id UUID REFERENCES medu_dictionary(id),
    english_concept TEXT NOT NULL,
    success_score REAL DEFAULT 0.5,
    last_used TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, dict_id, english_concept)
);

-- 4. Memory Nodes (Saved User Data)
CREATE TABLE IF NOT EXISTS memory_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    original_text TEXT NOT NULL,
    sign_sequence JSONB NOT NULL,
    next_review_at TIMESTAMPTZ DEFAULT now()
);

-- Seed data for tracer bullet
INSERT INTO medu_dictionary (transliteration, unicode_char, gardiner_code, english_glosses, semantic_tags, is_visual_anchor)
VALUES
  ('y', '𓇋', 'M17', '{"y"}', '{"variable", "phonetic"}', false),
  ('rxt', '𓍝', 'U39', '{"equals", "balance"}', '{"operator", "scale"}', true),
  ('m', '𓅓', 'G17', '{"m"}', '{"variable", "phonetic"}', false),
  ('xt', '𓐍𓏏𓏛', 'Aa1-X1-Y1', '{"x", "unknown", "thing"}', '{"variable", "concept"}', true),
  ('dmd', '𓍑', 'S23', '{"plus", "add", "unite"}', '{"operator", "join"}', true),
  ('b', '𓃀', 'D58', '{"b"}', '{"variable", "phonetic"}', false);
