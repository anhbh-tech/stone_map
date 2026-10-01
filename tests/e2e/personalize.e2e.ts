// E2E crew B: API personalize chạy trên next dev thật + worker inline + provider mock.
// Chạy: npx playwright test -c tests/e2e/personalize.config.ts
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_DB } from './personalize.config';

const FIX = path.join(__dirname, '..', 'fixtures');
const sql = () => new DatabaseSync(E2E_DB, { readOnly: true });

function product() {
  const d = sql();
  try {
    const p = d.prepare("SELECT id FROM products WHERE handle = 'pearl-pet-portrait'").get() as { id: number };
    const v = d.prepare('SELECT id, print_px FROM variants WHERE product_id = ? ORDER BY position').all(p.id) as { id: number; print_px: number }[];
    return { id: p.id, variants: v };
  } finally { d.close(); }
}

async function upload(request: APIRequestContext, name: string, consent = true) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    file: { name, mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(FIX, name)) },
  };
  if (consent) multipart.consent = '1';
  return request.post('/api/personalize/uploads', { multipart });
}

test.describe.configure({ mode: 'serial' });

test('upload without consent is refused (400 consent_required, #10)', async ({ request }) => {
  const r = await upload(request, 'pet-ok.jpg', false);
  expect(r.status()).toBe(400);
  expect((await r.json()).error.code).toBe('consent_required');
});

test('preflight blocks not-a-pet, blurry and too-small photos and passes pet-ok (#1)', async ({ request }) => {
  const want: Record<string, string | null> = { 'not-a-pet.jpg': 'no_pet', 'pet-blurry.jpg': 'blurry', 'pet-too-small.jpg': 'too_small', 'pet-ok.jpg': null };
  const { id: product_id } = product();
  for (const [name, code] of Object.entries(want)) {
    const r = await upload(request, name);
    expect(r.status(), name).toBe(201);
    const b = await r.json();
    expect(b.preflight.ok, name).toBe(code === null);
    if (code) {
      expect(b.preflight.issues.map((i: { code: string }) => i.code), name).toContain(code);
      const d = await request.post('/api/personalize/designs', { data: { product_id, upload_id: b.upload_id, mode: 'ai', style: 'royal-starry' } });
      expect(d.status(), name).toBe(422);
      expect((await d.json()).error.code).toBe('preflight_failed');
    }
  }
});

test('AI flow: generate → poll with a real, rising progress → preview → confirm', async ({ request }) => {
  test.setTimeout(90_000);
  const { id: product_id, variants } = product();
  const up = await (await upload(request, 'pet-ok.jpg')).json();
  const orig = await request.get(up.url);
  expect(orig.status()).toBe(200);
  expect(orig.headers()['content-type']).toBe('image/jpeg');

  const cr = await request.post('/api/personalize/designs', {
    data: { product_id, variant_id: variants[0].id, upload_id: up.upload_id, mode: 'ai', style: 'sunflower-queen', pet_name: 'Mochi', email: 'e2e@example.com' },
  });
  expect(cr.status()).toBe(201);
  const design = await cr.json();
  expect(design).toMatchObject({ status: 'draft', print_url: null, confirmed: false });

  const gr = await request.post(`/api/personalize/designs/${design.id}/generate`, { data: { style: 'sunflower-queen' } });
  expect(gr.status()).toBe(202);
  let job = await gr.json();
  expect(job.eta_ms).toBeGreaterThan(0);

  // Poll như trình duyệt (1.5 s). progress không lùi, không chạm 1 trước khi xong, eta còn > 0 khi đang chạy (#2).
  const seen: { progress: number; eta: number; stage: string | null }[] = [];
  const deadline = Date.now() + 75_000;
  while (job.status !== 'succeeded' && job.status !== 'failed' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    job = await (await request.get(`/api/personalize/jobs/${job.id}`)).json();
    seen.push({ progress: job.progress, eta: job.eta_ms, stage: job.stage });
    if (job.status === 'running' || job.status === 'queued') {
      expect(job.progress).toBeLessThan(1);
      expect(job.eta_ms).toBeGreaterThan(0);
    }
  }
  expect(job.status).toBe('succeeded');
  const running = seen.filter((s) => s.progress < 1);
  expect(running.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < running.length; i++) expect(running[i].progress).toBeGreaterThanOrEqual(running[i - 1].progress);
  expect(running.at(-1)!.progress).toBeGreaterThan(running[0].progress);
  expect(new Set(running.map((s) => s.stage)).size).toBeGreaterThanOrEqual(2);

  expect(job.design).toMatchObject({ status: 'ready', style: 'sunflower-queen', print_url: null });
  for (const u of [job.design.preview_url, job.design.mockup_url]) {
    const img = await request.get(u);
    expect(img.status(), u).toBe(200);
    expect(img.headers()['content-type']).toBe('image/webp');
  }

  // Email link quay lại design.
  const d = sql();
  const mail = d.prepare("SELECT to_addr, html FROM email_outbox WHERE kind = 'preview_ready' ORDER BY id DESC LIMIT 1").get() as { to_addr: string; html: string };
  d.close();
  expect(mail.to_addr).toBe('e2e@example.com');
  expect(mail.html).toContain(`/products/pearl-pet-portrait?design=${design.id}`);

  // v2: editor có template (lớp qua proxy cùng origin) + cutout; khách bấm OK → final mới theo transform.
  const pc = job.design.pc;
  expect(pc).toMatchObject({ theme: 'sunflower-queen', final_url: job.design.preview_url });
  for (const u of [pc.template.urls.base, pc.template.urls.overlay, pc.template.urls.canvas_bg, pc.cutout.url]) {
    const img = await request.get(u);
    expect(img.status(), u).toBe(200);
    expect(img.headers()['content-type'], u).toBe('image/png');
  }
  const rr = await request.post(`/api/personalize/designs/${design.id}/render`, { data: { transform: { ...pc.transform, rotate: -6, scale: pc.transform.scale * 0.9 } } });
  expect(rr.status()).toBe(200);
  const rendered = await rr.json();
  expect(rendered.pc.transform.rotate).toBe(-6);
  expect(rendered.preview_url).not.toBe(job.design.preview_url);
  expect((await request.get(rendered.preview_url)).status()).toBe(200);

  // Xác nhận "This is my pet".
  expect((await request.post(`/api/personalize/designs/${design.id}/confirm`, { data: {} })).status()).toBe(400);
  const cf = await request.post(`/api/personalize/designs/${design.id}/confirm`, { data: { confirmed: true } });
  expect(cf.status()).toBe(200);
  expect(await cf.json()).toMatchObject({ status: 'confirmed', confirmed: true, print_url: null });

  // File in được render (worker inline) nhưng không bao giờ ra qua /media.
  let printPath: string | null = null;
  for (let i = 0; i < 40 && !printPath; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const db = sql();
    printPath = (db.prepare('SELECT print_path FROM designs WHERE id = ?').get(design.id) as { print_path: string | null }).print_path;
    db.close();
  }
  expect(printPath).toMatch(/^print\/.+\.png$/);
  expect((await request.get(`/media/${printPath}`)).status()).toBe(404);
  expect((await request.get('/media/store.db')).status()).toBe(404);
  expect((await request.get('/media/uploads/..%2Fstore.db')).status()).toBe(404);
});

test('template slide: the theme product serves its empty-frame template', async ({ request }) => {
  const d = sql();
  const p = d.prepare("SELECT id FROM products WHERE handle = 'the-starry-king'").get() as { id: number } | undefined;
  d.close();
  const r = await request.get(p ? `/api/personalize/templates?product_id=${p.id}` : '/api/personalize/templates/royal-starry');
  expect(r.status()).toBe(200);
  const t = await r.json();
  expect(t).toMatchObject({ theme: 'royal-starry', kind: 'theme' });
  expect((await request.get(t.urls.empty)).headers()['content-type']).toBe('image/png');
  expect((await request.get('/api/personalize/pc/outputs/ref_000000000000.jpg')).status()).toBe(404);
});

test('fallback: an AI design goes to our designers with the original photo', async ({ request }) => {
  const { id: product_id } = product();
  const up = await (await upload(request, 'pet-ok.jpg')).json();
  const d = await (await request.post('/api/personalize/designs', { data: { product_id, upload_id: up.upload_id, mode: 'ai', style: 'ocean' } })).json();
  const g = await request.post(`/api/personalize/designs/${d.id}/generate`, { data: {} });
  expect(await g.json()).toMatchObject({ fallback: 'designer_upload' });
  const r = await request.post(`/api/personalize/designs/${d.id}/designer`, { data: { notes: 'Make it pearl' } });
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ mode: 'designer', status: 'in_review', notes: 'Make it pearl' });
});

test('designer finish: a photo that fails preflight can still be submitted for review (#11)', async ({ request }) => {
  const { id: product_id } = product();
  const up = await (await upload(request, 'not-a-pet.jpg')).json();
  const cr = await request.post('/api/personalize/designs', { data: { product_id, upload_id: up.upload_id, mode: 'designer', pet_name: 'Bean', notes: 'Please remove the leash' } });
  expect(cr.status()).toBe(201);
  const d = await cr.json();
  expect((await request.post(`/api/personalize/designs/${d.id}/generate`, { data: { style: 'royal-starry' } })).status()).toBe(409);
  const sub = await request.post(`/api/personalize/designs/${d.id}/submit`);
  expect(sub.status()).toBe(200);
  expect(await sub.json()).toMatchObject({ status: 'in_review', pet_name: 'Bean', notes: 'Please remove the leash' });
});
