import { describe, expect, it } from 'vitest';
import { Argon2PasswordService } from '../../src/application/services/password.service.js';

describe('Argon2PasswordService', () => {
  const svc = new Argon2PasswordService();

  it('hash produces an argon2id string never equal to the plaintext', async () => {
    const plain = 'a-very-real-password';
    const hash = await svc.hash(plain);
    expect(hash).not.toBe(plain);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash.length).toBeGreaterThan(40);
  });

  it('verify accepts the correct password and rejects wrong ones', async () => {
    const plain = 'correct horse battery staple';
    const hash = await svc.hash(plain);
    await expect(svc.verify(plain, hash)).resolves.toBe(true);
    await expect(svc.verify('wrong', hash)).resolves.toBe(false);
    await expect(svc.verify('', hash)).resolves.toBe(false);
  });

  it('verify returns false for malformed hashes instead of throwing', async () => {
    await expect(svc.verify('any', 'not-a-real-hash')).resolves.toBe(false);
  });

  it('hashes of the same password are different (random salts)', async () => {
    const plain = 'same-input';
    const a = await svc.hash(plain);
    const b = await svc.hash(plain);
    expect(a).not.toBe(b);
    await expect(svc.verify(plain, a)).resolves.toBe(true);
    await expect(svc.verify(plain, b)).resolves.toBe(true);
  });
});
