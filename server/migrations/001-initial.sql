CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TEXT,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  today_position INTEGER,
  in_today BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  source_id TEXT,
  source_url TEXT,
  class_name TEXT,
  source_details TEXT,
  external_url TEXT,
  sync_state TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS items_source_identity
  ON items (source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS activity_events (
  id BIGSERIAL PRIMARY KEY,
  item_id TEXT,
  action TEXT NOT NULL,
  section TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
