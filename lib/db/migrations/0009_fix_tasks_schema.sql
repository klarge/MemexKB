-- Add position column to tasks if it doesn't exist (was missing from the original migration)
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;

-- Drop the user_id foreign key and column from tasks if present.
-- Ownership is tracked on task_lists.user_id; tasks only need list_id.
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_user_id_users_id_fk";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "user_id";
