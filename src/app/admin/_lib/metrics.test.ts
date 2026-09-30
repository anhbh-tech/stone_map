import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-metrics-'));
process.env.DB_PATH = path.join(dir, 'store.db');
process.env.STORAGE_DIR = path.join(dir, 'storage');
const { db } = await import('../../../lib/db');
const { jobMetrics, percentile } = await import('./metrics');
const { mediaUrl, storageAbs, storageRel } = await import('./storage');
const { settingsSchemas, variantPatch, addonPatch, reviewPatch } = await import('./schemas');
const { DEFAULTS } = await import('../../../lib/settings');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('percentile', () => {
  it('uses nearest rank and handles empty input', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 75)).toBe(5);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([4, 1, 3, 2], 75)).toBe(3);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 75)).toBe(80);
  });
});

describe('jobMetrics', () => {
  it('computes durations, failure rate and preflight block rate from the tables', () => {
    const d = db();
    d.exec(`INSERT INTO products (id, handle, title) VALUES (1, 'p', 'P');
      INSERT INTO designs (id, product_id, mode) VALUES ('DSN-1', 1, 'ai');`);
    const job = d.prepare(`INSERT INTO jobs (id, design_id, status, provider, model, queued_at, finished_at)
      VALUES (?, 'DSN-1', ?, ?, 'm', datetime('now', ?), datetime('now'))`);
    job.run('j1', 'succeeded', 'mock', '-10 seconds');
    job.run('j2', 'succeeded', 'mock', '-20 seconds');
    job.run('j3', 'succeeded', 'gemini', '-40 seconds');
    job.run('j4', 'failed', 'gemini', '-5 seconds');
    job.run('old', 'failed', 'mock', '-30 days');   // ngoài cửa sổ 7 ngày
    d.exec("INSERT INTO jobs (id, design_id, status, provider, model) VALUES ('j5', 'DSN-1', 'queued', 'mock', 'm')");
    const up = d.prepare(`INSERT INTO uploads (id, path, mime, width, height, sha, preflight, consent_at, expires_at)
      VALUES (?, 'x', 'image/jpeg', 1, 1, 's', ?, datetime('now'), datetime('now'))`);
    up.run('u1', '{"ok":true}'); up.run('u2', '{"ok":false}'); up.run('u3', '{"ok":false}'); up.run('u4', 'not json');

    const m = jobMetrics(7);
    expect(m.jobs).toEqual({ total: 5, succeeded: 3, failed: 1, canceled: 0, pending: 1 });
    expect(m.duration.samples).toBe(3);
    expect(Math.round(m.duration.p50_ms! / 1000)).toBe(20);
    expect(Math.round(m.duration.p75_ms! / 1000)).toBe(40);
    expect(m.failure_rate).toBe(0.25);
    expect(m.uploads).toEqual({ total: 4, blocked: 2 });
    expect(m.preflight_block_rate).toBe(0.5);
    expect(m.by_provider.map((p) => [p.provider, p.succeeded, p.failed])).toEqual([['gemini', 1, 1], ['mock', 2, 0]]);
    expect(jobMetrics(60).jobs.failed).toBe(2);
  });
});

describe('storage paths', () => {
  it('maps DB paths into STORAGE and refuses traversal', () => {
    expect(storageRel('storage/designs/a.png')).toBe('designs/a.png');
    expect(storageRel('designs/a.png')).toBe('designs/a.png');
    expect(storageAbs('storage/designs/a.png')).toBe(path.join(dir, 'storage', 'designs', 'a.png'));
    expect(storageRel('../../etc/passwd')).toBeNull();
    expect(storageRel('/etc/passwd')).toBeNull();
    expect(storageRel('')).toBeNull();
    expect(mediaUrl('storage/uploads/up 1.jpg')).toBe('/media/uploads/up%201.jpg');
  });
});

describe('schemas', () => {
  it('accept the default settings for every key', () => {
    for (const k of Object.keys(settingsSchemas) as (keyof typeof settingsSchemas)[]) expect(settingsSchemas[k].safeParse(DEFAULTS[k]).success).toBe(true);
  });
  it('PATCH schemas never inject defaults for omitted fields', () => {
    expect(variantPatch.parse({ price_cents: 100 })).toEqual({ price_cents: 100 });
    expect(addonPatch.parse({ title: 'Frame' })).toEqual({ title: 'Frame' });
  });
  it('review PATCH only takes status', () => {
    expect(reviewPatch.safeParse({ status: 'hidden' }).success).toBe(true);
    expect(reviewPatch.safeParse({ status: 'hidden', is_sample: 1 }).success).toBe(false);
  });
});
