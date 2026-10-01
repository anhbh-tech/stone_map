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
  render: typeof import('../app/api/personalize/designs/[id]/render/route');
  designer: typeof import('../app/api/personalize/designs/[id]/designer/route');
  template: typeof import('../app/api/personalize/templates/[theme]/route');
  templates: typeof import('../app/api/personalize/templates/route');
  pc: typeof import('../app/api/personalize/pc/[...path]/route');
  engine: typeof import('../lib/personalize/engine');
  cart: typeof import('../lib/cart');
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
    render: await import('../app/api/personalize/designs/[id]/render/route'),
    designer: await import('../app/api/personalize/designs/[id]/designer/route'),
    template: await import('../app/api/personalize/templates/[theme]/route'),
    templates: await import('../app/api/personalize/templates/route'),
    pc: await import('../app/api/personalize/pc/[...path]/route'),
    engine: await import('../lib/personalize/engine'),
    cart: await import('../lib/cart'),
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
    const row = m.db.db().prepare('SELECT check_result, ext_id, progress FROM jobs WHERE id = ?').get(job.id) as { check_result: string; ext_id: string; progress: number };
    expect(JSON.parse(row.check_result)).toMatchObject({ engine: 'mock', pc_job: row.ext_id });
    expect(row.ext_id).toMatch(/^job-mock/);
    expect(done.steps.map((x: { stage: string }) => x.stage)).toEqual(['analyze', 'scene', 'cutout', 'final']);
    expect(done.fallback).toBeNull();
    // v2: template + cutout + transform cho editor, final = preview_url.
    const pc = done.design.pc;
    expect(pc).toMatchObject({ theme: 'cafe-duke', final_url: done.design.preview_url, pass: true, scene: false });
    expect(pc.cutout.url).toMatch(/^\/media\/cutouts\/.+\.png$/);
    expect(pc.transform).toEqual(pc.cutout.default_transform);
    expect(pc.template).toMatchObject({ theme: 'cafe-duke', kind: 'theme', size: { w: 1024, h: 1024 } });
    expect(pc.template.quad).toHaveLength(4);
    expect(pc.template.urls.base).toMatch(/^\/api\/personalize\/pc\/outputs\/templates\/cafe-duke_.+_base\.png$/);
    expect(pc.template.canvas_bg).toMatchObject({ w: expect.any(Number), h: expect.any(Number) });
  });
  it('serves template layers through the same-origin proxy, never other outputs', async () => {
    const d = await (await m.design.GET(get(), params({ id: designId }))).json();
    const segs = d.pc.template.urls.overlay.split('/').slice(4);
    const r = await m.pc.GET(get(), params({ path: segs }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    for (const p of [['outputs', 'ref_abc.jpg'], ['outputs', 'templates', '..', 'x.png'], ['etc', 'passwd'], ['outputs', 'templates', 'a.json']]) {
      expect((await m.pc.GET(get(), params({ path: p }))).status).toBe(404);
    }
    const c = await m.media.GET(get(), params({ path: d.pc.cutout.url.split('/').slice(2) }));
    expect(c.headers.get('content-type')).toBe('image/png');
  });
  it('OK in the editor re-renders the final with the normalised transform', async () => {
    const before = await (await m.design.GET(get(), params({ id: designId }))).json();
    const t = { ...before.pc.transform, x: 99999, scale: before.pc.transform.scale * 0.8, rotate: 190 };
    const r = await m.render.POST(post({ transform: t }), params({ id: designId }));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.pc.transform.x).toBeLessThanOrEqual(before.pc.template.quad[1][0]);
    expect(d.pc.transform.rotate).toBe(-170);
    expect(d.preview_url).not.toBe(before.preview_url);
    expect(d.pc.final_url).toBe(d.preview_url);
    const row = m.db.db().prepare('SELECT transform FROM designs WHERE id = ?').get(designId) as { transform: string };
    expect(JSON.parse(row.transform)).toEqual(d.pc.transform);
    expect((await m.render.POST(post({ transform: { x: 1 } }), params({ id: designId }))).status).toBe(400);
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
  it('confirm → confirmed, print file rendered at print_px² from the final', async () => {
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
    expect((await m.render.POST(post({ transform: { x: 500, y: 500, scale: 1, rotate: 0 } }), params({ id: designId }))).status).toBe(409);
  });
  it('the cart line and the order keep the transform and the pearl_compare final', () => {
    const cartId = 'cart_pc_test';
    m.db.db().prepare('INSERT INTO carts (id) VALUES (?)').run(cartId);
    m.cart.addLine(cartId, { variant_id: v12, qty: 1, design_id: designId });
    const line = m.db.db().prepare('SELECT properties FROM cart_lines WHERE cart_id = ?').get(cartId) as { properties: string };
    const props = JSON.parse(line.properties);
    const d = m.db.db().prepare('SELECT transform, pc FROM designs WHERE id = ?').get(designId) as { transform: string; pc: string };
    const pc = JSON.parse(d.pc);
    expect(props).toMatchObject({ _design_id: designId, _transform: d.transform, _pc_theme: 'cafe-duke', _pc_rev: pc.rev, _pc_final: pc.final_file, _pc_cutout: pc.cutout_file });
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
  it('a style without a pearl_compare theme is refused up front with the designer fallback', async () => {
    const up = await (await upload('pet-ok.jpg')).json();
    const d = await (await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'ai', style: 'ocean' }))).json();
    const r = await m.generate.POST(post({}), params({ id: d.id }));
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: { code: 'no_template' }, fallback: 'designer_upload' });
  });
  it('a failing generation marks the job and design failed with a readable error; retry is allowed', async () => {
    const up = await (await upload('pet-ok.jpg')).json();
    const d = await (await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'ai', style: 'royal-starry' }))).json();
    const job = await (await m.generate.POST(post({}), params({ id: d.id }))).json();
    // Ảnh gốc biến mất giữa chừng → worker không có gì để gen.
    fs.rmSync(path.join(process.env.STORAGE_DIR!, 'uploads', `${up.upload_id}.jpg`));
    await drain();
    const v = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(v.status).toBe('failed');
    expect(v.error).toMatch(/designers/);
    expect(v.fallback).toBe('designer_upload');
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

describe('pearl_compare adapter (scripted engine)', () => {
  type Client = import('../lib/personalize/pearl-compare').PcClient;
  type PcJob = import('../lib/personalize/pearl-compare').PcJob;

  async function aiDesign(style = 'royal-starry') {
    const up = await (await upload('pet-ok.jpg')).json();
    const d = await (await m.designs.POST(post({ product_id: productId, upload_id: up.upload_id, mode: 'ai', style }))).json();
    const job = await (await m.generate.POST(post({}), params({ id: d.id }))).json();
    return { d, job };
  }
  async function runWith(client: Client, opts: { sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {}) {
    const s = m.settings.getSettings();
    for (let j = m.jobs.claimNext(); j; j = m.jobs.claimNext()) await m.proc.processJob(j, { settings: s, sleep: opts.sleep ?? (async () => {}), client, timeoutMs: opts.timeoutMs });
  }
  /** Bọc engine giả lập: job() trả lần lượt các progress cho trước rồi mới "done". */
  async function scripted(progress: number[]): Promise<{ client: Client; sent: unknown[] }> {
    const { mockClient } = await import('../lib/personalize/pc-mock');
    const base = mockClient({ ms: 0 });
    const sent: unknown[] = [];
    let i = 0;
    const stage = (p: number) => (p < 0.1 ? 'analyze' : p < 0.9 ? 'cutout' : 'final');
    const running = (id: string, p: number): PcJob => ({ id, status: 'running', progress: p, theme: 'royal-starry', steps: [{ id: 1, stage: stage(p), status: 'running' }], cutouts: [], template: null });
    const client: Client = {
      ...base,
      name: 'pearl_compare',
      async startCutout(b) { sent.push(b); const j = await base.startCutout(b); return running(j.id, 0.02); },
      async job(id) { return i < progress.length ? running(id, progress[i++]) : base.job(id); },
    };
    return { client, sent };
  }

  it('sends the rollout request and mirrors the real, rising progress of pearl_compare', async () => {
    const { d, job } = await aiDesign();
    const { client, sent } = await scripted([0.1, 0.35, 0.3, 0.62, 0.9]);
    const seen: { progress: number; stage: string; message: string }[] = [];
    await runWith(client, { sleep: async () => {
      const v = await (await m.job.GET(get(), params({ id: job.id }))).json();
      seen.push({ progress: v.progress, stage: v.stage, message: v.message });
    } });
    expect(sent[0]).toMatchObject({ theme: 'royal-starry', provider: 'fal', modelId: 'fal-ai/gemini-3-pro-image-preview/edit', maxFixes: 1, scene: true, outfitRef: false });
    expect((sent[0] as { refImage: string }).refImage).toMatch(/^data:image\/jpeg;base64,/);
    // Đọc trước mỗi lượt poll: progress là số của pearl_compare, không giảm khi pearl_compare báo lùi (0.35 → 0.3).
    expect(seen.map((x) => x.progress)).toEqual([0.02, 0.1, 0.35, 0.35, 0.62, 0.9]);
    expect(seen[0].message).toBe('Studying your photo…');
    expect(seen.at(-1)).toMatchObject({ stage: 'rendering', message: 'Placing your portrait in the frame…' });
    const done = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(done).toMatchObject({ status: 'succeeded', progress: 1, design: { id: d.id, status: 'ready' } });
    expect(done.design.pc.cutout.url).toMatch(/^\/media\/cutouts\//);
  });

  it('pearl_compare offline → failed with the offline message and the designer fallback', async () => {
    const { d, job } = await aiDesign();
    const { client } = await scripted([]);
    const { PcError: E } = await import('../lib/personalize/pearl-compare');
    await runWith({ ...client, startCutout: async () => { throw new E('unavailable', 'connect ECONNREFUSED'); } });
    const v = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(v).toMatchObject({ status: 'failed', fallback: 'designer_upload', progress: 0 });
    expect(v.error).toMatch(/offline/);
    expect(v.message).toBe(v.error);
    const row = m.db.db().prepare('SELECT check_result FROM jobs WHERE id = ?').get(job.id) as { check_result: string };
    expect(JSON.parse(row.check_result).error).toMatch(/ECONNREFUSED/);
    expect((await (await m.design.GET(get(), params({ id: d.id }))).json()).status).toBe('failed');
  });

  it('a pearl_compare job error or a job with no final → failed', async () => {
    const { job } = await aiDesign();
    const { client } = await scripted([]);
    await runWith({ ...client, job: async (id) => ({ id, status: 'done', progress: 1, theme: 'royal-starry', notes: ['model không dùng ảnh pet'], steps: [], cutouts: [], template: null }) });
    const v = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(v).toMatchObject({ status: 'failed', fallback: 'designer_upload' });
    const row = m.db.db().prepare('SELECT check_result FROM jobs WHERE id = ?').get(job.id) as { check_result: string };
    expect(JSON.parse(row.check_result).error).toMatch(/model không dùng ảnh pet/);
  });

  it('a job that never finishes times out with the slow message', async () => {
    const { job } = await aiDesign();
    const { client } = await scripted(Array(10_000).fill(0.5));
    await runWith(client, { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), timeoutMs: 60 });
    const v = await (await m.job.GET(get(), params({ id: job.id }))).json();
    expect(v).toMatchObject({ status: 'failed', fallback: 'designer_upload' });
    expect(v.error).toMatch(/longer than it should/);
  });

  it('"Upload original photo for designers" turns a failed AI design into an in-review designer design', async () => {
    const { d } = await aiDesign();
    const { client } = await scripted([]);
    const { PcError: E } = await import('../lib/personalize/pearl-compare');
    await runWith({ ...client, startCutout: async () => { throw new E('unavailable', 'down'); } });
    const r = await m.designer.POST(post({ pet_name: 'Bo', notes: 'keep the red collar' }), params({ id: d.id }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: d.id, mode: 'designer', status: 'in_review', pet_name: 'Bo', notes: 'keep the red collar', pc: null });
    expect((await m.designer.POST(post({}), params({ id: d.id }))).status).toBe(200);           // idempotent
    const cartId = 'cart_pc_fallback';
    m.db.db().prepare('INSERT INTO carts (id) VALUES (?)').run(cartId);
    expect(() => m.cart.addLine(cartId, { variant_id: v12, qty: 1, design_id: d.id })).not.toThrow();
  });

  it('cancels a running AI job when the customer switches to designers', async () => {
    const { d, job } = await aiDesign();
    const r = await m.designer.POST(post({}), params({ id: d.id }));
    expect(r.status).toBe(200);
    expect((await (await m.job.GET(get(), params({ id: job.id }))).json()).status).toBe('canceled');
  });
});

describe('template routes', () => {
  it('serves the product theme template (empty-frame slide) through the mock engine', async () => {
    m.db.db().prepare("INSERT OR IGNORE INTO product_tags (product_id, tag) VALUES (?, 'style:sunflower-queen')").run(productId);
    expect(m.engine.themeForProduct(productId)).toBe('sunflower-queen');
    const r = await m.templates.GET(new Request(`http://t/api/personalize/templates?product_id=${productId}`));
    expect(r.status).toBe(200);
    const t = await r.json();
    expect(t).toMatchObject({ theme: 'sunflower-queen', kind: 'theme' });
    expect(t.urls.empty).toMatch(/^\/api\/personalize\/pc\/outputs\/templates\/sunflower-queen_.+_empty\.png$/);
    m.db.db().prepare("DELETE FROM product_tags WHERE product_id = ? AND tag = 'style:sunflower-queen'").run(productId);
    expect((await m.template.GET(get(), params({ theme: 'ocean' }))).status).toBe(404);
  });
  it('a real engine that is down answers 503 with the designer fallback', async () => {
    const prev = process.env.PEARL_COMPARE_URL;
    process.env.PEARL_COMPARE_URL = 'http://127.0.0.1:9';                  // cổng discard: không ai nghe
    const s = m.settings.getSettings();
    m.settings.setSetting('ai', { ...s.ai, provider: 'gemini' });
    m.engine.clearTemplateCache();
    try {
      const r = await m.template.GET(get(), params({ theme: 'royal-starry' }));
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ error: { code: 'engine_unavailable' }, fallback: 'designer_upload' });
    } finally {
      m.settings.setSetting('ai', s.ai);
      if (prev === undefined) delete process.env.PEARL_COMPARE_URL; else process.env.PEARL_COMPARE_URL = prev;
    }
  });
});
