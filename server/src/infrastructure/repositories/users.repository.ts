import type { Db } from '../db/connection.js';
import type { User, UserWithSecret } from '../../domain/user.js';
import { ConflictError } from '../../shared/errors.js';

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  is_admin: number;
  must_change_password: number;
  created_at: string;
  password_updated_at: string | null;
  temporary_password_created_at: string | null;
}

const SELECT_COLUMNS = `
  id,
  username,
  email,
  password_hash,
  is_admin,
  must_change_password,
  created_at,
  password_updated_at,
  temporary_password_created_at
`;

function rowToPublic(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    passwordUpdatedAt: row.password_updated_at,
    temporaryPasswordCreatedAt: row.temporary_password_created_at,
  };
}

function rowToSecret(row: UserRow): UserWithSecret {
  return { ...rowToPublic(row), passwordHash: row.password_hash };
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  email?: string | null;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  /** When the temporary password was minted (used to age out unused accounts later). */
  temporaryPasswordCreatedAt?: string | null;
}

export interface UpdateUserSecretInput {
  passwordHash: string;
  /**
   * When updating to a chosen password the user just typed, this is "now".
   * When updating to a freshly-generated temp password it stays null so the
   * UI can tell setup-required accounts apart.
   */
  passwordUpdatedAt: string | null;
  mustChangePassword: boolean;
  temporaryPasswordCreatedAt: string | null;
}

export class UsersRepository {
  constructor(private readonly db: Db) {}

  findByUsername(username: string): UserWithSecret | null {
    const row = this.db
      .prepare<[string], UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users WHERE username = ? COLLATE NOCASE`,
      )
      .get(username);
    return row ? rowToSecret(row) : null;
  }

  /**
   * Look up every account that uses a given email (case-insensitive). Emails
   * are NOT unique, so this can return zero, one, or many rows. The
   * password-reset flow uses the count to decide whether an email identifies a
   * single account or is too ambiguous to act on.
   */
  findManyByEmail(email: string): UserWithSecret[] {
    return this.db
      .prepare<[string], UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users
         WHERE email = ? COLLATE NOCASE
         ORDER BY id ASC`,
      )
      .all(email)
      .map(rowToSecret);
  }

  findById(id: number): User | null {
    const row = this.db
      .prepare<[number], UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`)
      .get(id);
    return row ? rowToPublic(row) : null;
  }

  findSecretById(id: number): UserWithSecret | null {
    const row = this.db
      .prepare<[number], UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`)
      .get(id);
    return row ? rowToSecret(row) : null;
  }

  /**
   * Create a user. Throws ConflictError if the username already exists.
   * (Emails are not unique, so they never cause a conflict here.)
   */
  create(input: CreateUserInput): User {
    try {
      const info = this.db
        .prepare(
          `INSERT INTO users (
             username, email, password_hash, is_admin, must_change_password,
             temporary_password_created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.username,
          input.email ?? null,
          input.passwordHash,
          input.isAdmin ? 1 : 0,
          input.mustChangePassword ? 1 : 0,
          input.temporaryPasswordCreatedAt ?? null,
        );
      const id = Number(info.lastInsertRowid);
      const created = this.findById(id);
      if (!created) {
        throw new Error('User was inserted but could not be read back.');
      }
      return created;
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        throw new ConflictError(`Username already exists.`);
      }
      throw err;
    }
  }

  /**
   * Atomically update the password hash and the related flags. Used by both
   * the first-time setup flow and the password-reset flow.
   */
  updateSecret(userId: number, update: UpdateUserSecretInput): void {
    this.db
      .prepare(
        `UPDATE users
           SET password_hash = ?,
               password_updated_at = ?,
               must_change_password = ?,
               temporary_password_created_at = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        update.passwordHash,
        update.passwordUpdatedAt,
        update.mustChangePassword ? 1 : 0,
        update.temporaryPasswordCreatedAt,
        userId,
      );
  }

  updateEmail(userId: number, email: string): void {
    // Emails are not unique, so this can never hit a constraint conflict.
    this.db
      .prepare(
        `UPDATE users
           SET email = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(email, userId);
  }

  listAll(): User[] {
    return this.db
      .prepare<[], UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users ORDER BY id ASC`,
      )
      .all()
      .map(rowToPublic);
  }

  countAdmins(): number {
    const row = this.db
      .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1')
      .get();
    return row?.c ?? 0;
  }
}
