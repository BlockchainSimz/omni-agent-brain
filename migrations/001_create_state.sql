-- Omni Agent Brain persistence schema v1
CREATE TABLE IF NOT EXISTS omni_brain_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_brain_state_updated_at_idx
  ON omni_brain_state (updated_at);
