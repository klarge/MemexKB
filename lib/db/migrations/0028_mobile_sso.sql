CREATE TABLE IF NOT EXISTS "mobile_sso" (
  "ticket_hash" text PRIMARY KEY,
  "provider_id" integer NOT NULL REFERENCES "sso_configs"("id") ON DELETE CASCADE,
  "challenge" text NOT NULL,
  "state" text NOT NULL,
  "started" boolean NOT NULL DEFAULT false,
  "saml_request_id" text,
  "saml_request_instant" text,
  "code_hash" text UNIQUE,
  "user_id" integer REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL
);
