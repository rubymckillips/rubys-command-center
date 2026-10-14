CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id TEXT UNIQUE,
  login TEXT NOT NULL,
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO users(id,login) VALUES ('legacy','Legacy workspace');
ALTER TABLE items ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES users(id);
ALTER TABLE activity_events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES users(id);
DROP INDEX items_source_identity;
CREATE UNIQUE INDEX items_source_identity ON items(workspace_id,source,source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX items_workspace ON items(workspace_id,section);
CREATE INDEX activity_workspace ON activity_events(workspace_id,id);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE oauth_attempts (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
