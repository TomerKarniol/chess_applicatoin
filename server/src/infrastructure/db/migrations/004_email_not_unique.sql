-- 004_email_not_unique: emails are no longer required to be unique. Several
-- accounts may now share one address (e.g. siblings under a parent's email, or
-- a whole class under a teacher's email). Replace the UNIQUE index with a plain
-- index so email lookups for the password-reset flow stay fast.

DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
