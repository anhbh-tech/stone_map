// Luồng đầy đủ qua route handler + worker trên DB tạm: upload → design → generate → job → confirm → file in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-b-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.STORAGE_DIR = path.join(tmp, 'storage');

type Mods = {
  db: typeof import('../lib/db');
  settings: typeof import('../lib/settings');
  jobs: typeof import('../lib/personalize/jobs');
  retention: typeof import('../lib/personalize/retention');
  proc: typeof import('./process');
  uploads: typeof import('../app/api/personalize/uploads/route');
  designs: typeof import('../app/api/personalize/designs/route');
  design: typeof import('../app/api/personalize/designs/[id]/route');
  generate: typeof import('../app/api/personalize/designs/[id]/generate/route');
  confirm: typeof import('../app/api/personalize/designs/[id]/confirm/route');
  submit: typeof import('../app/api/personalize/designs/[id]/submit/route');
  job: typeof import('../app/api/personalize/jobs/[id]/route');
  media: typeof import('../app/media/[...path]/route');
};
let m: Mods;
let productId = 0, v12 = 0, v20 = 0;

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name));
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const post = (body: unknown) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const patch = (body: unknown) => new Request('http://t/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = () => new Request('http://t/x');

async function upload(name: string, consent = true) {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(fixture(name))], name, { type: 'image/jpeg' }));
  if (consent) fd.append('consent', '1');
  return m.uploads.POST(new Request('http://t/api/personalize/uploads', { method: 'POST', body: fd }));
}

/** Chạy hết job đang chờ bằng provider mock không chờ. */
async function drain() {
  const s = m.settings.getSettings();
  const fast = { ...s, ai: { ...s.ai, mock_ms: 0 } };
  for (let j = m.jobs.claimNext(); j; j = m.jobs.claimNext()) await m.proc.processJob(j, { settings: fast, sleep: async () => {} });
}

beforeAll(async () => {
  m = {
    db: await import('../lib/db'),
    settings: await import('../lib/settings'),
    jobs: await import('../lib/personalize/jobs'),
    retention: await import('../lib/personalize/retention'),
    proc: await import('./process'),
    uploads: await import('../app/api/personalize/uploads/route'),
    designs: await import('../app/api/personalize/designs/route'),
    design: await import('../app/api/personalize/designs/[id]/route'),
    generate: await import('../app/api/personalize/designs/[id]/generate/route'),
    confirm: await import('../app/api/personalize/designs/[id]/confirm/route'),
    submit: await import('../app/api/personalize/designs/[id]/submit/route'),
    job: await import('../app/api/personalize/jobs/[id]/route'),
    media: await import('../app/media/[...path]/route'),
  };
  const d = m.db.db();
  productId = (d.prepare("INSERT INTO products (handle, title) VALUES ('pearl-pet-portrait', 'Pearl Pet Portrait') RETURNING id").get() as { id: number }).id;
  const v = d.prepare('INSERT INTO variants (product_id, sku, size, price_cents, print_px) VALUES (?, ?, ?, ?, ?) RETURNING id');
  v12 = (v.get(productId, 'S12', '12×12', 5998, 600) as { id: number }).id;   // print_px nhỏ cho test nhanh
  v20 = (v.get(productId, 'S20', '20×20', 11998, 900) as { id: number }).id;
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('uploads', () => {
  it('rejects an upload without consent (400 consent_required)', async () => {
    const r = await upload('pet-ok.jpg', false);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('consent_required');
    expect(m.db.db().prepare('SELECT count(*) n FROM uploads').get()).toMatchObject({ n: 0 });
  });
  it('stores consent_at / expires_at and returns the preflight', async () => {
    const r = await upload('pet-ok.jpg');
    expect(r.status).toBe(201);
    const b = await r.json();
    expect(b.preflight.ok).toBe(true);
    expect(b.url).toMatch(/^\/media\/uploads\/up_.+\.jpg$/);
    const row = m.db.db().prepare('SELECT consent_at, expires_at FROM uploads WHERE id = ?').get(b.upload_id) as { consent_at: string; expires_at: string };
    const days = (Date.parse(row.expires_at) - Date.parse(row.consent_at)) / 86_400_000;
    expect(days).toBe(m.settings.DEFAULTS.privacy.retention_days);
  });
  it('refuses an AI design from a photo that failed preflight (422)', async () => {
    const up = await (await upload('not-a-pet.jpg')).json();
    expect(up.preflight.ok).toBe(false);
    const r = await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'ai', style: 'royal-starry' }));
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('preflight_failed');
    // Designer finish vẫn được.
    const dz = await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'designer', pet_name: 'Mochi', notes: 'remove the leash' }));
    expect(dz.status).toBe(201);
    const view = await dz.json();
    const sub = await m.submit.POST(post({}), params({ id: view.id }));
    expect((await sub.json()).status).toBe('in_review');
  });
});

describe('ai design → job → confirm', () => {
  let designId = '';
  it('creates a draft design', async () => {
    const up = await (await upload('pet-ok.jpg')).json();
    const r = await m.designs.POST(post({ product_id: productId, variant_id: v12, upload_id: up.upload_id, mode: 'ai', style: 'royal-starry', email: 'kim@example.com', pet_name: 'Mochi' }));
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d).toMatchObject({ mode: 'ai', status: 'draft', style: 'royal-starry', confirmed: false, print_url: null });
    expect(d.id).toMatch(/^DSN-[A-Z2-9]{6}$/);
    designId = d.id;
  });
  it('cannot confirm before a preview exists', async () => {
    const r = await m.confirm.POST(post({ confirmed: true }), params({ id: designId }));
    expect(r.status).toBe(409);
  });
  it('generate → 202 JobView with a real eta, then worker finishes it', async () => {
    const r = await m.generate.POST(post({ style: 'cafe-duke' }), params({ id: designId }));
    expect(r.status).toBe(202);
    const job = await r.json();
    expect(job).toMatchObject({ design_id: designId, status: 'queued', queue_position: 0, design: null });
    expect(job.eta_ms).toBe(m.settings.DEFAULTS.ai.mock_ms);          // chưa có lịch sử → mock_ms
    // Gọi lại khi đang chạy trả đúng job đó.
    expect((await (await m.generate.POST(post({ style: 'cafe-duke' }), params({ id: designId }))).json()).id).toBe(job.id);

    await drain();
    const done = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(done).toMatchObject({ status: 'succeeded', progress: 1, eta_ms: 0, error: null });
    expect(done.design).toMatchObject({ status: 'ready', style: 'cafe-duke' });
    expect(done.design.preview_url).toMatch(/^\/media\/previews\/.+\.webp$/);
    expect(done.design.mockup_url).toMatch(/^\/media\/mockups\/.+\.webp$/);
    const row = m.db.db().prepare('SELECT check_result, attempts FROM jobs WHERE id = ?').get(job.id) as { check_result: string; attempts: number };
    expect(JSON.parse(row.check_result).checks).toHaveLength(1);
    expect(row.attempts).toBe(1);
  });
  it('queues a preview_ready email with a link back to the design', () => {
    const e = m.db.db().prepare("SELECT to_addr, html FROM email_outbox WHERE kind = 'preview_ready'").get() as { to_addr: string; html: string };
    expect(e.to_addr).toBe('kim@example.com');
    expect(e.html).toContain(`/products/pearl-pet-portrait?design=${designId}`);
  });
  it('serves the preview and upload but never the print file or the database', async () => {
    const d = await (await m.design.GET(get(), params({ id: designId }))).json();
    const [, , dir, file] = d.preview_url.split('/');
    const ok = await m.media.GET(get(), params({ path: [dir, file] }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/webp');
    const [, , udir, ufile] = d.upload_url.split('/');
    expect((await m.media.GET(get(), params({ path: [udir, ufile] }))).status).toBe(200);
    for (const p of [['print', 'x.png'], ['generated', 'x.png'], ['test.db'], ['..', 'test.db'], ['previews', '..', 'test.db'], ['previews', '../test.db']]) {
      expect((await m.media.GET(get(), params({ path: p }))).status).toBe(404);
    }
  });
  it('rejects confirm without the tick', async () => {
    const r = await m.confirm.POST(post({}), params({ id: designId }));
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('confirmation_required');
  });
  it('confirm → confirmed, print file rendered at print_px² with the transform', async () => {
    const t = { rotate: 90, zoom: 1.5, x: 0.1, y: -0.1 };
    expect((await m.design.PATCH(patch({ transform: t }), params({ id: designId }))).status).toBe(200);
    const r = await m.confirm.POST(post({ confirmed: true }), params({ id: designId }));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d).toMatchObject({ status: 'confirmed', confirmed: true, print_url: null });
    await drain();
    const sharp = (await import('sharp')).default;
    const row = m.db.db().prepare('SELECT print_path FROM designs WHERE id = ?').get(designId) as { print_path: string };
    expect(row.print_path).toMatch(/^print\//);
    const meta = await sharp(path.join(process.env.STORAGE_DIR!, row.print_path)).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 600, height: 600, density: 300 });
  });
  it('locks the image after confirm; changing size re-renders the print', async () => {
    const locked = await m.design.PATCH(patch({ transform: { rotate: 0, zoom: 1, x: 0, y: 0 } }), params({ id: designId }));
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe('design_locked');
    expect((await m.design.PATCH(patch({ variant_id: v20 }), params({ id: designId }))).status).toBe(200);
    await drain();
    const row = m.db.db().prepare('SELECT print_path FROM designs WHERE id = ?').get(designId) as { print_path: string };
    const sharp = (await import('sharp')).default;
    expect((await sharp(path.join(process.env.STORAGE_DIR!, row.print_path)).metadata()).width).toBe(900);
  });
});

describe('job failure and retry', () => {
  it('a failing generation marks the job and design failed with a readable error; retry is allowed', async () => {
    const up = await (await upload('pet-ok.jpg')).json();
    const d = await (await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'ai', style: 'ocean' }))).json();
    const job = await (await m.generate.POST(post({}), params({ id: d.id }))).json();
    // Ảnh gốc biến mất giữa chừng → worker không có gì để gen.
    fs.rmSync(path.join(process.env.STORAGE_DIR!, 'uploads', `${up.upload_id}.jpg`));
    await drain();
    const v = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(v.status).toBe('failed');
    expect(v.error).toMatch(/Designer finish/);
    expect((await (await m.design.GET(get(), params({ id: d.id }))).json()).status).toBe('failed');
  });
});

describe('queue eta', () => {
  it('uses p75 of recent real durations and adds the jobs ahead', async () => {
    const d = m.db.db();
    d.exec("DELETE FROM jobs WHERE kind = 'ai_generate' AND status = 'succeeded'");   // chỉ giữ lịch sử của test này
    const ins = d.prepare("INSERT INTO jobs (id, design_id, kind, status, provider, model, queued_at, started_at, finished_at) VALUES (?, ?, 'ai_generate', 'succeeded', 'mock', 'm', ?, ?, ?)");
    const anyDesign = (d.prepare('SELECT id FROM designs LIMIT 1').get() as { id: string }).id;
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    [4000, 5000, 6000, 7000, 8000].forEach((ms, i) => {
      const s = new Date(t0 + i * 60_000);
      ins.run(`job_hist${i}`, anyDesign, s.toISOString(), s.toISOString(), new Date(s.getTime() + ms).toISOString());
    });
    const up = await (await upload('pet-ok.jpg')).json();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const dz = await (await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'ai', style: 'royal-starry' }))).json();
      ids.push((await (await m.generate.POST(post({}), params({ id: dz.id }))).json()).id);
    }
    const second = await (await m.job.GET(get(), params({ id: ids[1] }))).json();
    expect(second.queue_position).toBe(1);
    expect(second.eta_ms).toBe(7000 + 7000);                            // p75 = 7000: job trước + chính nó
    expect(second.progress).toBeGreaterThanOrEqual(0);
    expect(second.progress).toBeLessThan(0.5);
    await drain();
  });
});

describe('retention', () => {
  it('deletes expired upload files and hides upload_url', async () => {
    const up = await (await upload('pet-ok.jpg')).json();
    const dz = await (await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'designer' }))).json();
    expect(dz.upload_url).not.toBeNull();
    m.db.db().prepare("UPDATE uploads SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(up.upload_id);
    expect(m.retention.purgeExpiredUploads()).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(process.env.STORAGE_DIR!, 'uploads', `${up.upload_id}.jpg`))).toBe(false);
    expect((await (await m.design.GET(get(), params({ id: dz.id }))).json()).upload_url).toBeNull();
  });
});
