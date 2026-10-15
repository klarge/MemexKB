ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS autosave_started_at timestamptz;
