ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "manager_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
UPDATE "projects" SET "manager_id" = "created_by_id" WHERE "manager_id" IS NULL;