import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMP_PASSWORD_LENGTH,
  generateTempPassword,
} from '../../src/application/services/temp-password.js';

describe('generateTempPassword', () => {
  it('returns a string of the requested length', () => {
    expect(generateTempPassword()).toHaveLength(DEFAULT_TEMP_PASSWORD_LENGTH);
    expect(generateTempPassword(16)).toHaveLength(16);
  });

  it('omits visually-ambiguous glyphs (0, 1, O, l, I)', () => {
    for (let i = 0; i < 100; i++) {
      const pw = generateTempPassword(20);
      expect(pw).not.toMatch(/[01OlI]/);
    }
  });

  it('always contains at least one letter and one digit', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/[A-Za-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });

  it('rejects lengths below the floor', () => {
    expect(() => generateTempPassword(4)).toThrow();
  });

  it('produces different passwords on repeated calls', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20; i++) set.add(generateTempPassword());
    expect(set.size).toBe(20);
  });
});
