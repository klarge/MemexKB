-- Give every log a stable, owner-scoped URL segment. The existing global slug
-- becomes an internal identifier for logs so different users may use the same
-- date or title without colliding.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS log_slug text;

UPDATE articles
SET log_slug = slug
WHERE is_log_entry = true
  AND log_slug IS NULL;

-- Logs are always private; remove legacy sharing associations before applying
-- the new invariant.
DELETE FROM article_groups
WHERE article_id IN (SELECT id FROM articles WHERE is_log_entry = true);

-- Existing log owners were backfilled when created_by_id was introduced. A log
-- without an owner cannot be safely exposed as a personal URL, so fail the
-- migration instead of silently making it public.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM articles
    WHERE is_log_entry = true
      AND created_by_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot migrate log entries without an owner';
  END IF;
END $$;

-- Assign a collision-safe internal slug to every legacy log. Its public URL is
-- created_by_id + log_slug; this global slug is only used internally.
DO $$
DECLARE
  log_row record;
  candidate text;
  suffix integer;
BEGIN
  FOR log_row IN
    SELECT id FROM articles WHERE is_log_entry = true
  LOOP
    candidate := 'private-log-' || log_row.id::text;
    suffix := 0;
    WHILE EXISTS (
      SELECT 1 FROM articles
      WHERE slug = candidate AND id <> log_row.id
    ) LOOP
      suffix := suffix + 1;
      candidate := 'private-log-' || log_row.id::text || '-' || suffix::text;
    END LOOP;
    UPDATE articles SET slug = candidate WHERE id = log_row.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS articles_log_owner_slug_unique
  ON articles (created_by_id, log_slug)
  WHERE log_slug IS NOT NULL;