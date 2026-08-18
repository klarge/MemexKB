-- Add archivedAt to projects and boards for soft-archive support
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE boards   ADD COLUMN IF NOT EXISTS archived_at timestamptz;
