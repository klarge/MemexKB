ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "articles" ADD CONSTRAINT "articles_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_project_updated_idx" ON "articles" ("project_id", "updated_at");