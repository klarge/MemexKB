CREATE TABLE IF NOT EXISTS "edit_locks" (
  "article_id" integer PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "locked_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "edit_locks" ADD CONSTRAINT "edit_locks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "edit_locks" ADD CONSTRAINT "edit_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
