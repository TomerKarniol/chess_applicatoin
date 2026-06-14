import { randomInt } from 'node:crypto';

/**
 * Alphabet free of visually-ambiguous glyphs. We drop:
 *   - digits 0 and 1
 *   - letters O, l, I (mixed-case lookalikes for 0 / 1)
 * so an admin can read a temp password aloud or copy from a printout
 * without provoking "is that a one or an L" support tickets.
 */
const TEMP_PASSWORD_ALPHABET =
  '23456789' +
  'ABCDEFGHJKLMNPQRSTUVWXYZ' +
  'abcdefghijkmnopqrstuvwxyz';

export const DEFAULT_TEMP_PASSWORD_LENGTH = 12;

/**
 * Generate a cryptographically random temporary password. The generator
 * guarantees at least one letter and one digit so the result will pass
 * the same policy a user would face on first-time setup — this means an
 * admin who wants to test the temp pwd in the login page can do so even
 * though it's only meant to bootstrap the setup flow.
 */
export function generateTempPassword(length: number = DEFAULT_TEMP_PASSWORD_LENGTH): string {
  if (length < 6) throw new Error('Temporary password length must be at least 6.');
  while (true) {
    const chars = new Array<string>(length);
    for (let i = 0; i < length; i++) {
      chars[i] = TEMP_PASSWORD_ALPHABET[randomInt(0, TEMP_PASSWORD_ALPHABET.length)]!;
    }
    const out = chars.join('');
    const hasLetter = /[A-Za-z]/.test(out);
    const hasDigit = /[0-9]/.test(out);
    if (hasLetter && hasDigit) return out;
    // Otherwise loop — virtually never happens at length ≥ 8 with this alphabet.
  }
}
