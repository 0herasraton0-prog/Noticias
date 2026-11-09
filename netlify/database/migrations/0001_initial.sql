CREATE TABLE IF NOT EXISTS editorial_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for TIMESTAMPTZ NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  topic_key TEXT NOT NULL,
  title TEXT NOT NULL,
  dek TEXT NOT NULL,
  body JSONB NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('current', 'curiosity')),
  category TEXT,
  region TEXT CHECK (region IS NULL OR region IN ('Spain', 'Latin America', 'International')),
  event_date DATE,
  published_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'published', 'blocked', 'archived')),
  cover_url TEXT,
  cover_source_url TEXT,
  cover_credit TEXT,
  cover_license TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  reading_minutes INTEGER,
  cycle_id UUID REFERENCES editorial_cycles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_publication_idx ON articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS articles_category_idx ON articles (category, published_at DESC);

CREATE TABLE IF NOT EXISTS homepage_featured_curiosities (
  article_id UUID PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES editorial_cycles(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  featured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, position)
);

CREATE TABLE IF NOT EXISTS article_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  published_at TIMESTAMPTZ,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_kind TEXT NOT NULL DEFAULT 'web',
  reliability_notes TEXT,
  UNIQUE (article_id, source_url)
);

CREATE TABLE IF NOT EXISTS article_metrics_daily (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  engaged_seconds BIGINT NOT NULL DEFAULT 0,
  next_article_clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day)
);

CREATE TABLE IF NOT EXISTS cycle_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES editorial_cycles(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  outcome TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_instruction_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  reason TEXT NOT NULL,
  evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_name, version)
);

CREATE TABLE IF NOT EXISTS api_usage_monthly (
  month DATE PRIMARY KEY,
  estimated_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

