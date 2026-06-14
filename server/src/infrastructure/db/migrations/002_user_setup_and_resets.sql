-- 002_user_setup_and_resets: add per-user metadata for first-time setup,
-- the admin role, and the password-reset code/session machinery.

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;
ALTER TABLE users ADD COLUMN temporary_password_created_at TEXT;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- A NULL email is allowed for legacy users; only set rows must be unique.
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

-- One row per issued reset code. We keep the row after use so we can audit
-- attempts and so a single code cannot be reused.
CREATE TABLE password_reset_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  verified_at  TEXT,
  used_at      TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_prc_user_id    ON password_reset_codes(user_id);
CREATE INDEX idx_prc_expires_at ON password_reset_codes(expires_at);

-- A separate, short-lived session that's only useful for the
-- reset-password endpoint. Kept distinct from `sessions` so a normal login
-- session cannot ever be used to set a new password without proving the
-- code, and a reset session cannot ever be used to act as the user.
CREATE TABLE reset_sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_id    INTEGER NOT NULL REFERENCES password_reset_codes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_rs_user_id    ON reset_sessions(user_id);
CREATE INDEX idx_rs_expires_at ON reset_sessions(expires_at);
