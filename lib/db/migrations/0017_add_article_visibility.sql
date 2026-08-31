ALTER TABLE "articles" ADD COLUMN "visibility" text DEFAULT 'personal' NOT NULL;

UPDATE "articles"
SET "created_by_id" = (
  SELECT "id"
  FROM "users"
  WHERE "role" = 'admin'
  ORDER BY "id"
  LIMIT 1
)
WHERE "created_by_id" IS NULL
  AND "is_log_entry" = false
  AND "project_id" IS NULL;

UPDATE "articles"
SET "visibility" = 'group'
WHERE "is_log_entry" = false
  AND "project_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "article_groups"
    WHERE "article_groups"."article_id" = "articles"."id"
  );

ALTER TABLE "articles"
  ADD CONSTRAINT "articles_visibility_check"
  CHECK ("visibility" IN ('personal', 'group', 'public'));

CREATE INDEX "articles_visibility_owner_idx"
  ON "articles" USING btree ("visibility", "created_by_id");