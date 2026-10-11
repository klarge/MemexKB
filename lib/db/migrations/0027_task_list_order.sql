ALTER TABLE "task_lists" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) - 1 AS position
  FROM task_lists
)
UPDATE task_lists SET position = ordered.position FROM ordered WHERE task_lists.id = ordered.id;
