CREATE TYPE user_role AS ENUM ('admin', 'editor', 'user');
CREATE TABLE users (
  id serial PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  password_hash text NOT NULL, role user_role NOT NULL DEFAULT 'user',
  sso_provider text, sso_id text, sso_only boolean NOT NULL DEFAULT false,
  must_reset_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE password_reset_tokens (
  id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE groups (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE group_members (
  group_id integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,user_id)
);
CREATE INDEX group_members_user_id ON group_members(user_id);
CREATE TABLE sso_configs (
  id serial PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('saml','oidc')),
  name text NOT NULL, enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE saml_requests (
  request_id text PRIMARY KEY, provider_id integer NOT NULL REFERENCES sso_configs(id) ON DELETE CASCADE,
  value text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE site_settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE user_sessions (
  sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL
);
CREATE INDEX user_sessions_expire ON user_sessions(expire);
