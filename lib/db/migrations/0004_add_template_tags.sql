CREATE TABLE IF NOT EXISTS "template_tags" (
  "template_id" integer NOT NULL,
  "tag_id" integer NOT NULL,
  CONSTRAINT "template_tags_template_id_tag_id_pk" PRIMARY KEY("template_id","tag_id")
);

ALTER TABLE "template_tags" ADD CONSTRAINT "template_tags_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "template_tags" ADD CONSTRAINT "template_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
