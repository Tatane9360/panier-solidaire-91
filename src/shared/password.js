import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// Format stocké : "<sel en hexa>:<empreinte en hexa>".
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const candidate = await scryptAsync(password, Buffer.from(salt, 'hex'), KEY_LENGTH);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
