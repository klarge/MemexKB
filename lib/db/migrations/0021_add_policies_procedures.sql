CREATE TABLE IF NOT EXISTS policy_subjects (
  id serial PRIMARY KEY, name text NOT NULL,
  parent_id integer REFERENCES policy_subjects(id) ON DELETE RESTRICT
);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'knowledge';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS policy_subject_id integer REFERENCES policy_subjects(id) ON DELETE RESTRICT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS procedure_steps jsonb NOT NULL DEFAULT '[]';
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS policy_subject_id integer;
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS procedure_steps jsonb NOT NULL DEFAULT '[]';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'knowledge';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS procedure_steps jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS procedure_runs (
  key text PRIMARY KEY, source_slug text NOT NULL,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  board_id integer NOT NULL
);
INSERT INTO templates(name, content, kind, procedure_steps)
SELECT 'Policy', '<h2>Purpose</h2><p></p><h2>Scope</h2><p></p><h2>Policy</h2><p></p>', 'policy', '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='policy');
INSERT INTO templates(name, content, kind, procedure_steps)
SELECT 'Procedure', '<h2>Purpose</h2><p></p>', 'procedure',
  '[{"title":"First step","description":"Describe the action to take."}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='procedure');
INSERT INTO site_settings(key, value)
SELECT 'policy_template_id', id::text FROM templates WHERE kind='policy' ORDER BY id LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO site_settings(key, value)
SELECT 'procedure_template_id', id::text FROM templates WHERE kind='procedure' ORDER BY id LIMIT 1
ON CONFLICT DO NOTHING;