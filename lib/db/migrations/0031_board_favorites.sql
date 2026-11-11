ALTER TABLE "favorites" ADD COLUMN "board_id" integer;
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_board_id_boards_id_fk"
  FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_board_unique" UNIQUE ("user_id", "board_id");
--> statement-breakpoint
ALTER TABLE "favorites" DROP CONSTRAINT "favorites_one_target";
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_one_target"
  CHECK (num_nonnulls("article_id", "project_id", "board_id") = 1);
