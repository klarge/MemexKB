CREATE TABLE IF NOT EXISTS "projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "created_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_groups" (
  "project_id" integer NOT NULL,
  "group_id" integer NOT NULL,
  CONSTRAINT "project_groups_pkey" PRIMARY KEY ("project_id", "group_id")
);

CREATE TABLE IF NOT EXISTS "boards" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "name" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "board_columns" (
  "id" serial PRIMARY KEY NOT NULL,
  "board_id" integer NOT NULL,
  "name" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "board_cards" (
  "id" serial PRIMARY KEY NOT NULL,
  "column_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "due_date" timestamp with time zone,
  "position" integer NOT NULL DEFAULT 0,
  "created_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "board_card_members" (
  "card_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  CONSTRAINT "board_card_members_pkey" PRIMARY KEY ("card_id", "user_id")
);

ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "project_groups" ADD CONSTRAINT "project_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_groups" ADD CONSTRAINT "project_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_cards" ADD CONSTRAINT "board_cards_column_id_board_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."board_columns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_cards" ADD CONSTRAINT "board_cards_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "board_card_members" ADD CONSTRAINT "board_card_members_card_id_board_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."board_cards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_card_members" ADD CONSTRAINT "board_card_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
