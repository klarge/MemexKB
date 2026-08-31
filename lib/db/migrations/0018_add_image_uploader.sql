ALTER TABLE "article_images"
  ADD COLUMN "uploaded_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL;