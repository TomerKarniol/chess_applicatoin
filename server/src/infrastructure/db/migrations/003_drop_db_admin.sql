-- 003_drop_db_admin: admin is now sourced from .env (ADMIN_USERNAME / ADMIN_PASSWORD)
-- rather than stored as a `users` row. Delete any pre-existing admin rows
-- so the DB cleanly reflects the new model. The `is_admin` column is kept
-- on `users` for forward compatibility — it just always reads `0` after this.
--
-- Cascading deletes on `sessions`, `user_progress`, and `password_reset_codes`
-- mean dropping the admin row(s) cleans up any orphaned data automatically.

DELETE FROM users WHERE is_admin = 1;
