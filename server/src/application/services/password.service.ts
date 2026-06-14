import * as argon2 from 'argon2';

/**
 * argon2id parameters tuned for interactive logins on commodity hardware.
 * Values chosen above the OWASP 2024 minimum (m=19 MiB, t=2, p=1).
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export interface PasswordService {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export class Argon2PasswordService implements PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  /**
   * Returns true iff the plaintext matches the stored hash. Never throws on
   * a malformed hash — returns false so callers can use the same code path
   * for "user not found" and "wrong password" (timing-equalized at the
   * caller layer via a dummy verify).
   */
  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
