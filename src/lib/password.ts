import crypto from 'node:crypto';
export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [s, h] = stored.split(':');
  if (!s || !h) return false;
  const got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(h, 'hex'));
}
