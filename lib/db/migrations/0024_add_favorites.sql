CREATE TABLE IF NOT EXISTS "favorites" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "article_id" integer REFERENCES "articles"("id") ON DELETE CASCADE,
  "project_id" integer REFERENCES "projects"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "favorites_user_article_unique" UNIQUE ("user_id", "article_id"),
  CONSTRAINT "favorites_user_project_unique" UNIQUE ("user_id", "project_id"),
  CONSTRAINT "favorites_one_target" CHECK (("article_id" IS NOT NULL) <> ("project_id" IS NOT NULL))
);