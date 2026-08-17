CREATE TABLE IF NOT EXISTS "board_card_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "card_id" integer NOT NULL,
  "user_id" integer,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "board_card_comments" ADD CONSTRAINT "board_card_comments_card_id_board_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."board_cards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_card_comments" ADD CONSTRAINT "board_card_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
