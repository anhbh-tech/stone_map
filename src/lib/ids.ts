import crypto from 'node:crypto';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ 0/O/1/I để đọc qua điện thoại không nhầm
export function code(n: number) {
  const b = crypto.randomBytes(n);
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
}
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
export const designId = () => `DSN-${code(6)}`;
