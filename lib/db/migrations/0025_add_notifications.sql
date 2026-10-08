CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "card_assigned" boolean NOT NULL DEFAULT false,
  "project_added" boolean NOT NULL DEFAULT false,
  "card_due" boolean NOT NULL DEFAULT false,
  "due_soon_hours" integer NOT NULL DEFAULT 24
);
CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" serial PRIMARY KEY,
  "dedupe_key" text NOT NULL UNIQUE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "card_id" integer REFERENCES "board_cards"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "due_date" timestamptz,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz,
  "last_error" text
);
CREATE INDEX IF NOT EXISTS "notification_outbox_pending_idx" ON "notification_outbox" ("status", "available_at");
