ALTER TABLE "api_tokens"
  ADD COLUMN IF NOT EXISTS "access_mode" text NOT NULL DEFAULT 'full';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_tokens"
    ADD CONSTRAINT "api_tokens_access_mode_check"
    CHECK ("access_mode" IN ('full', 'read_only'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;