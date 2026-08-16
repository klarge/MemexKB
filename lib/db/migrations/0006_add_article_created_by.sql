ALTER TABLE articles ADD COLUMN created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
-- Back-fill: treat the original updatedById as the creator for existing log entries
UPDATE articles SET created_by_id = updated_by_id WHERE is_log_entry = true;
