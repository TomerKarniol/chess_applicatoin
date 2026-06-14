export interface User {
  readonly id: number;
  readonly username: string;
  readonly email: string | null;
  readonly isAdmin: boolean;
  readonly mustChangePassword: boolean;
  readonly createdAt: string;
  readonly passwordUpdatedAt: string | null;
  readonly temporaryPasswordCreatedAt: string | null;
}

export interface UserWithSecret extends User {
  readonly passwordHash: string;
}

export const USERNAME_MIN = 1;
export const USERNAME_MAX = 64;
export const PASSWORD_MIN = 1;
export const PASSWORD_MAX = 256;

/**
 * Minimum length and complexity for a user-chosen password.
 *
 * The OWASP 2024 guidance recommends prioritizing length over character
 * classes. For a children's chess app we land on a friendlier policy:
 * at least 6 characters, with at least one letter and one digit.
 */
export const NEW_PASSWORD_MIN = 6;
export const NEW_PASSWORD_MAX = 256;
const LETTER_RE = /\p{L}/u;
const DIGIT_RE = /\p{N}/u;

export interface PasswordPolicyViolation {
  code: 'too_short' | 'too_long' | 'missing_letter' | 'missing_digit';
  message: string;
}

export function validateNewPassword(plain: string): PasswordPolicyViolation | null {
  if (plain.length < NEW_PASSWORD_MIN) {
    return { code: 'too_short', message: `Password must be at least ${NEW_PASSWORD_MIN} characters.` };
  }
  if (plain.length > NEW_PASSWORD_MAX) {
    return { code: 'too_long', message: `Password must be at most ${NEW_PASSWORD_MAX} characters.` };
  }
  if (!LETTER_RE.test(plain)) {
    return { code: 'missing_letter', message: 'Password must contain at least one letter.' };
  }
  if (!DIGIT_RE.test(plain)) {
    return { code: 'missing_digit', message: 'Password must contain at least one digit.' };
  }
  return null;
}

/**
 * Returns a sanitized public-facing user (no password material).
 */
export function publicUser(u: UserWithSecret | User): User {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    isAdmin: u.isAdmin,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
    passwordUpdatedAt: u.passwordUpdatedAt,
    temporaryPasswordCreatedAt: u.temporaryPasswordCreatedAt,
  };
}
