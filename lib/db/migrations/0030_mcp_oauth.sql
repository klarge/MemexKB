CREATE TABLE IF NOT EXISTS oauth_clients (
  id text PRIMARY KEY, name text NOT NULL, redirect_uris text[] NOT NULL,
  auth_method text NOT NULL, secret_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_grants (
  id text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_grants_user_idx ON oauth_grants(user_id);
CREATE TABLE IF NOT EXISTS oauth_codes (
  hash text PRIMARY KEY, grant_id text NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL, challenge text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash text PRIMARY KEY, grant_id text NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant_idx ON oauth_tokens(grant_id);
