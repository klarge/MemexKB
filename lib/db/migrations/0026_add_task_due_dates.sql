ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "due_date" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "task_due" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "task_id" integer
  CONSTRAINT "notification_outbox_task_id_tasks_id_fk"
  REFERENCES "tasks"("id") ON DELETE CASCADE;
