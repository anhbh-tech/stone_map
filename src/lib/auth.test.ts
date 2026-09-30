import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-auth-'));
process.env.DB_PATH = path.join(dir, 'store.db');
const { db } = await import('./db');
const { hashPassword } = await import('./password');
const auth = await import('./auth');

db().prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hashPassword('admin123'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('checkCredentials', () => {
  it('accepts the right password and rejects wrong ones or unknown users', () => {
    expect(auth.checkCredentials('admin', 'admin123')).toMatchObject({ username: 'admin' });
    expect(auth.checkCredentials('admin', 'admin1234')).toBeNull();
    expect(auth.checkCredentials('nobody', 'admin123')).toBeNull();
  });
});

describe('sessions', () => {
  it('stores only a hash of the token and resolves the user until expiry', () => {
    const user = auth.checkCredentials('admin', 'admin123')!;
    const now = new Date('2026-09-30T00:00:00Z');
    const { token, expires } = auth.createSession(user.id, now);
    expect(expires.getTime() - now.getTime()).toBe(auth.SESSION_TTL_S * 1000);
    expect(db().prepare('SELECT count(*) AS n FROM admin_sessions WHERE token = ?').get(token)).toEqual({ n: 0 });
    expect(auth.userForToken(token, now)).toEqual(user);
    expect(auth.userForToken(token, new Date(expires.getTime() + 1))).toBeNull();
    expect(auth.userForToken('forged', now)).toBeNull();
    expect(auth.userForToken(undefined, now)).toBeNull();
    auth.destroySession(token);
    expect(auth.userForToken(token, now)).toBeNull();
  });

  it('sets an httpOnly, SameSite=strict cookie', () => {
    expect(auth.sessionCookie('t', new Date())).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
  });
});

describe('login throttle', () => {
  it('blocks after 10 failures within 15 minutes, then recovers', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 9; i++) auth.recordLoginFailure('ip|admin', t0);
    expect(auth.loginThrottled('ip|admin', t0)).toBe(0);
    auth.recordLoginFailure('ip|admin', t0);
    expect(auth.loginThrottled('ip|admin', t0)).toBe(15 * 60);
    expect(auth.loginThrottled('ip|admin', t0 + 15 * 60 * 1000 + 1)).toBe(0);
    auth.clearLoginFailures('ip|admin');
  });
});

describe('safeNext', () => {
  it('only allows internal admin paths', () => {
    expect(auth.safeNext('/admin/orders?status=paid')).toBe('/admin/orders?status=paid');
    expect(auth.safeNext('/admin')).toBe('/admin');
    for (const bad of ['https://evil.test', '//evil.test/admin', '/administrator', '/admin/login', '/\\evil', null, '']) expect(auth.safeNext(bad)).toBe('/admin');
  });
});
