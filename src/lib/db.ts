// Lớp DB dùng chung: node:sqlite (Node ≥ 22.5), không ORM. Mọi module import `db()` từ đây.
// Chủ sở hữu: lead. Thêm bảng/cột → db/migrations/NNN_*.sql (chạy theo thứ tự tên file, mỗi file 1 lần).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
export const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'storage', 'store.db');
export const STORAGE = process.env.STORAGE_DIR || path.join(ROOT, 'storage');

let conn: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (conn) return conn;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  conn = new DatabaseSync(DB_PATH);
  conn.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
  migrate(conn);
  return conn;
}

function migrate(d: DatabaseSync) {
  d.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const dir = path.join(ROOT, 'db', 'migrations');
  if (!fs.existsSync(dir)) return;
  const done = new Set((d.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    d.exec('BEGIN');
    try {
      d.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      d.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
      d.exec('COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
  }
}

/** Chạy fn trong 1 transaction. */
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec('BEGIN');
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
