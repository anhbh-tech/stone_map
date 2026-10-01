// e2e editor theo lớp trên PDP (v2, pearl_compare docs/OUTPUT.md): base → canvasBg → pet (cắt theo clip) → overlay,
// kéo / 4 góc / xoay, nút xoay-phóng-dịch, Replace photo / Cancel / OK đỏ, nút Edit trên thẻ ảnh mở lại editor.
// Mọi /api/** đều mock (không gọi pearl_compare, không gen thật). Ảnh lớp là PNG một màu tạo bằng sharp để đọc lại
// pixel trên canvas và kiểm đúng thứ tự lớp + vùng cắt.
import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PDP = '/products/pearl-pet-portrait'; // API mock hết → sản phẩm nào cũng được (sản phẩm theme là draft trong DB e2e)
const FIX = path.resolve(__dirname, '../fixtures');
const SHOTS = process.env.EDITOR_SHOTS; // thư mục lưu screenshot (tuỳ chọn)
const PC_OUTPUTS = process.env.PC_OUTPUTS; // thư mục outputs/ của pearl_compare: test ảnh thật (chỉ đọc file, không gọi server)
const RED = 'rgb(198, 42, 47)'; // --accent (light)

// Template 400×400, canvas trong khung = quad [100..300] × [80..320].
const quad = [[100, 80], [300, 80], [300, 320], [100, 320]];
const clip = [[98, 78], [302, 78], [302, 322], [98, 322]];
const C = { base: [200, 180, 150], frame: [60, 40, 30], bg: [40, 60, 200], pet: [220, 30, 30] };
const T0 = { x: 200, y: 200, scale: 1, rotate: 0 };

async function png(w: number, h: number, rgb: number[], hole?: (x: number, y: number) => boolean) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, on = hole ? hole(x, y) : true;
    buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = on ? 255 : 0;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

type Call = { method: string; path: string; body: unknown };
const bodyOf = (r: Request) => ((r.headers()['content-type'] || '').includes('application/json') ? r.postDataJSON() : null);

type PcOf = (t: typeof T0, n: number) => object;
async function mockApi(page: Page, { renderFails = false, pcOf }: { renderFails?: boolean; pcOf?: PcOf } = {}) {
  const layers: Record<string, Buffer> = {
    'base.png': await png(400, 400, C.base),
    // overlay: chỉ viền khung 8 px quanh quad là đục, còn lại trong suốt → ngoài viền thấy base (kiểm vùng cắt pet).
    'overlay.png': await png(400, 400, C.frame, (x, y) => x >= 92 && x < 308 && y >= 72 && y < 328 && !(x >= 100 && x < 300 && y >= 80 && y < 320)),
    'bg.png': await png(200, 240, C.bg),
    'cut.png': await png(100, 100, C.pet),
  };
  await page.route('**/e2e-layers/*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: layers[route.request().url().split('/').pop()!] }));

  const calls: Call[] = [];
  let done = false, renders = 0;
  const pc = pcOf || ((transform: typeof T0, n: number) => ({
    theme: 'royal-starry',
    template: {
      theme: 'royal-starry', rev: 'rev-e2e', kind: 'scene', size: { w: 400, h: 400 }, quad, clip, canvas_bg: { w: 200, h: 240 },
      urls: { base: '/e2e-layers/base.png', canvas_bg: '/e2e-layers/bg.png', overlay: '/e2e-layers/overlay.png', mask: null, empty: null },
    },
    cutout: { url: '/e2e-layers/cut.png', w: 100, h: 100, default_transform: T0, bottom_cut: false },
    transform, final_url: `/demo/starry-king.webp?r=${n}`, pass: true, why: [], scene: true, rendered_at: '2026-10-01T00:00:00Z',
  }));
  let design = {
    id: 'DSN-ED01', mode: 'ai', status: 'draft', style: 'royal-starry', pet_name: null, notes: null, product_id: 1, theme: 'royal-starry',
    upload_url: '/demo/cafe-duke.webp', preview_url: null as string | null, mockup_url: null, print_url: null, confirmed: false, pc: null as object | null,
  };
  const json = (status: number, data: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const job = (over: object) => ({ id: 'job_ed', design_id: design.id, queue_position: 0, error: null, design: null, steps: [], fallback: null, ...over });

  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const p = new URL(r.url()).pathname;
    calls.push({ method: r.method(), path: p, body: bodyOf(r) });
    if (p === '/api/personalize/uploads') {
      return route.fulfill(json(201, {
        upload_id: `up_${calls.length}`, url: '/demo/cafe-duke.webp',
        preflight: { ok: true, width: 1600, height: 1067, sharpness: 210, pet: { found: true, species: 'dog', confidence: 0.97, box: [0.2, 0.1, 0.8, 0.9] }, issues: [] },
      }));
    }
    if (p === '/api/personalize/designs') return route.fulfill(json(201, (design = { ...design, status: 'draft', preview_url: null, pc: null })));
    const m = p.match(/^\/api\/personalize\/designs\/[^/]+(?:\/(generate|render|confirm))?$/);
    if (m?.[1] === 'generate') { done = false; return route.fulfill(json(202, job({ status: 'queued', stage: 'queued', elapsed_ms: 0, eta_ms: 8000, progress: 0, message: 'Waiting for a free pearl artist…' }))); }
    if (m?.[1] === 'render') {
      if (renderFails) return route.fulfill(json(502, { error: { code: 'engine_error', message: 'The preview engine is busy. Please try again.' }, fallback: 'designer_upload' }));
      const t = (bodyOf(r) as { transform: typeof T0 }).transform;
      renders++;
      design = { ...design, preview_url: `/demo/starry-king.webp?r=${renders}`, pc: pc(t, renders) };
      return route.fulfill(json(200, design));
    }
    if (m) return route.fulfill(json(200, design));
    if (p === '/api/personalize/jobs/job_ed') {
      if (!done) return route.fulfill(json(200, job({ status: 'running', stage: 'generating', elapsed_ms: 3000, eta_ms: 5000, progress: 0.4, message: 'Turning your pet into pearls…' })));
      design = { ...design, status: 'ready', preview_url: '/demo/starry-king.webp?r=0', pc: pc(T0, 0) };
      return route.fulfill(json(200, job({ status: 'succeeded', stage: null, elapsed_ms: 8000, eta_ms: 0, progress: 1, design })));
    }
    return route.fulfill(json(200, { lines: [] }));
  });
  return {
    calls, release: () => { done = true; },
    renders: () => calls.filter((c) => c.path.endsWith('/render')),
  };
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Adjust your pet' });
const canvas = (page: Page) => page.getByTestId('layer-canvas');
const tOf = async (page: Page) => JSON.parse((await canvas(page).getAttribute('data-transform'))!) as typeof T0;
/** Màu pixel trên canvas tại toạ độ template (x, y). */
const px = (page: Page, x: number, y: number) => canvas(page).evaluate((cv: HTMLCanvasElement, [x, y]) => {
  const k = cv.width / 400;
  return [...cv.getContext('2d')!.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data.slice(0, 3)];
}, [x, y]);
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 12);

async function toEditor(page: Page, api: Awaited<ReturnType<typeof mockApi>>) {
  await page.goto(PDP);
  await page.getByTestId('consent').check();
  await page.getByTestId('photo-input').setInputFiles(path.join(FIX, 'pet-ok.jpg'));
  await expect(page.getByTestId('media-card')).toBeVisible();
  await page.getByRole('button', { name: /Generate with AI/ }).click();
  const modal = page.getByRole('dialog', { name: 'AI Filter' });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Turning your pet into pearls…'); // câu theo bước của pearl_compare
  api.release();
  await expect(modal).toBeHidden({ timeout: 10_000 });
  // Có final theo lớp → editor tự mở (như pearl_compare), ảnh lớp tải xong → canvas.
  await expect(editor(page)).toBeVisible();
  await expect(canvas(page)).toBeVisible();
}

for (const vp of [{ name: '1440', width: 1440, height: 900, mobile: false }, { name: '375', width: 375, height: 812, mobile: true }]) {
  test.describe(`layer editor @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });

    test('renders base → canvasBg → pet (clipped) → overlay; tools, OK renders, Edit reopens, Cancel keeps', async ({ page }) => {
      const api = await mockApi(page);
      await toEditor(page, api);
      const ed = editor(page);

      // Thứ tự lớp: pet ở giữa, nền canvas trong khung, base ngoài khung, viền khung (overlay) đè lên trên.
      await expect.poll(async () => near(await px(page, 200, 200), C.pet)).toBe(true);
      expect(near(await px(page, 120, 110), C.bg)).toBe(true);
      expect(near(await px(page, 40, 40), C.base)).toBe(true);
      expect(near(await px(page, 96, 200), C.frame)).toBe(true);

      // Vừa màn hình: không cuộn ngang, canvas nằm trọn trong dialog.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = (await canvas(page).boundingBox())!, dbox = (await ed.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(dbox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dbox.x + dbox.width + 0.5);
      expect(dbox.y + dbox.height).toBeLessThanOrEqual(vp.height);
      await expect(ed.getByRole('button', { name: 'OK' })).toHaveCSS('background-color', RED);
      await expect(ed.getByRole('button', { name: 'OK' })).toBeInViewport();
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `after-editor-${vp.name}.png`) });

      // Nút: dịch phải 1% bề ngang (4 px), phóng 4%, xoay 3°.
      await ed.getByRole('button', { name: 'Move right' }).click();
      await ed.getByRole('button', { name: 'Zoom in' }).click();
      await ed.getByRole('button', { name: 'Rotate right' }).click();
      expect(await tOf(page)).toEqual({ x: 204, y: 200, scale: 1.04, rotate: 3 });
      await expect(ed.getByTestId('layer-readout')).toHaveText('Size 104% · 3°');
      await ed.getByRole('button', { name: 'Reset' }).click();
      expect(await tOf(page)).toEqual(T0);

      // Bàn phím trên canvas.
      await canvas(page).focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press(']');
      expect(await tOf(page)).toMatchObject({ y: 204, rotate: 3 });
      await ed.getByRole('button', { name: 'Reset' }).click();

      // Kéo thân pet (chuột) → di chuyển; kéo tới mép phải: phần pet ngoài clip bị cắt (thấy base).
      if (!vp.mobile) {
        const k = box.width / 400, at = (x: number, y: number) => [box.x + x * k, box.y + y * k] as const;
        await page.mouse.move(...at(200, 200));
        await page.mouse.down();
        await page.mouse.move(...at(260, 220), { steps: 5 });
        await page.mouse.up();
        const t1 = await tOf(page);
        expect(t1.x).toBeCloseTo(260, 0);
        expect(t1.y).toBeCloseTo(220, 0);
        await page.mouse.move(...at(t1.x, t1.y));
        await page.mouse.down();
        await page.mouse.move(...at(360, t1.y), { steps: 5 });
        await page.mouse.up();
        expect((await tOf(page)).x).toBe(300); // tâm kẹp vào hình chữ nhật trong của quad (như server)
        expect(near(await px(page, 296, 220), C.pet)).toBe(true);
        expect(near(await px(page, 304, 220), C.frame)).toBe(true);
        expect(near(await px(page, 330, 220), C.base)).toBe(true); // pet tới 350 nhưng bị cắt theo clip
        // Kéo núm góc dưới phải (350, 270) ra xa tâm → to hơn.
        const t2 = await tOf(page);
        await page.mouse.move(...at(t2.x + 50, t2.y + 50));
        await page.mouse.down();
        await page.mouse.move(...at(t2.x + 75, t2.y + 75), { steps: 5 });
        await page.mouse.up();
        expect((await tOf(page)).scale).toBeCloseTo(1.5, 1);
      } else {
        // Chạm: kéo một ngón (touch) qua dispatch pointer events.
        await canvas(page).dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, button: 0, isPrimary: true });
        await canvas(page).dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: box.x + box.width / 2 + 30, clientY: box.y + box.height / 2, isPrimary: true });
        await canvas(page).dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
        // pointermove là cập nhật ưu tiên continuous: React commit sau khi dispatchEvent trả về → poll, không đọc một lần.
        await expect.poll(async () => (await tOf(page)).x).toBeGreaterThan(210);
      }

      // OK → render với đúng transform đang thấy → dialog đóng, ảnh trên thẻ đổi sang final mới.
      const t = await tOf(page);
      await ed.getByRole('button', { name: 'OK' }).click();
      await expect(ed).toBeHidden();
      expect(api.renders()).toHaveLength(1);
      expect((api.renders()[0].body as { transform: typeof T0 }).transform).toEqual(t);
      const card = page.getByTestId('media-card');
      await expect(card.getByRole('img', { name: /portrait preview/ })).toHaveAttribute('src', /r=1/);
      await expect(page.getByTestId('layered-preview')).toBeVisible();
      // Pet là nhân vật chính: dưới 640 px final full-width, ảnh gốc chỉ là ô nhỏ chồng góc.
      const fw = (await page.getByTestId('layered-preview').getByRole('img', { name: 'Your portrait preview' }).boundingBox())!.width;
      const ow = (await page.getByTestId('layered-preview').getByRole('img', { name: 'Your original photo' }).boundingBox())!.width;
      expect(vp.mobile ? fw > 300 && ow < fw / 3 : Math.abs(fw - ow) < 2).toBe(true);
      await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
      if (SHOTS) await page.getByTestId('layered-preview').screenshot({ path: path.join(SHOTS, `after-preview-${vp.name}.png`) });

      // Edit trên thẻ ảnh → mở lại với transform đã lưu; Cancel → giữ, không render.
      await card.getByRole('button', { name: 'Edit portrait' }).click();
      await expect(ed).toBeVisible();
      await expect.poll(() => tOf(page)).toEqual(t);
      await ed.getByRole('button', { name: 'Move up' }).click();
      await ed.getByRole('button', { name: 'Cancel' }).click();
      await expect(ed).toBeHidden();
      expect(api.renders()).toHaveLength(1);
      // Esc = Cancel.
      await page.getByTestId('layered-adjust').click();
      await expect(ed).toBeVisible();
      await expect.poll(() => tOf(page)).toEqual(t);
      await page.keyboard.press('Escape');
      await expect(ed).toBeHidden();
      expect(api.renders()).toHaveLength(1);

      // Replace photo → đóng editor, mở chọn ảnh.
      await card.getByRole('button', { name: 'Edit portrait' }).click();
      const chooser = page.waitForEvent('filechooser');
      await ed.getByRole('button', { name: 'Replace photo' }).click();
      await chooser;
      await expect(ed).toBeHidden();
    });
  });
}

test('render error keeps the editor open and shows the error', async ({ page }) => {
  const api = await mockApi(page, { renderFails: true });
  await toEditor(page, api);
  const ed = editor(page);
  await ed.getByRole('button', { name: 'Zoom out' }).click();
  await ed.getByRole('button', { name: 'OK' }).click();
  await expect(ed.getByRole('alert')).toHaveText('The preview engine is busy. Please try again.');
  await expect(ed).toBeVisible();
  await expect(ed.getByRole('button', { name: 'OK' })).toBeEnabled();
});

// Ảnh thật của pearl_compare (template royal-starry + cutout của final gần nhất) — chỉ chạy khi có PC_OUTPUTS, để soát mắt.
test('real pearl_compare layers (visual check)', async ({ page }) => {
  test.skip(!PC_OUTPUTS, 'PC_OUTPUTS not set');
  const dir = PC_OUTPUTS!;
  const tpl = JSON.parse(fs.readFileSync(path.join(dir, 'templates/royal-starry.json'), 'utf8'));
  const fin = fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((x) => x.variant === 'final' && x.cutout && x.template === tpl.rev).pop();
  const size = (f: string) => sharp(path.join(dir, f)).metadata().then((m) => ({ w: m.width!, h: m.height! }));
  const cut = await size(fin.cutout);
  await page.route('**/pc-real/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(dir, decodeURIComponent(new URL(route.request().url()).pathname.replace('/pc-real/', '')))) }));
  const u = (f: string | null) => (f ? `/pc-real/${f}` : null);
  const pcOf: PcOf = (t, n) => ({
    theme: 'royal-starry', transform: n ? t : fin.transform, final_url: '/demo/starry-king.webp', pass: true, why: [], scene: false, rendered_at: tpl.time,
    template: { theme: 'royal-starry', rev: tpl.rev, kind: 'theme', size: tpl.size, quad: tpl.quad, clip: tpl.clip, canvas_bg: tpl.canvasBgInfo,
      urls: { base: u(`templates/${tpl.base}`), canvas_bg: u(tpl.canvasBg && `templates/${tpl.canvasBg}`), overlay: u(`templates/${tpl.overlay}`), mask: null, empty: null } },
    cutout: { url: u(fin.cutout), ...cut, default_transform: fin.transform, bottom_cut: true },
  });
  const api = await mockApi(page, { pcOf });
  await page.setViewportSize({ width: 1440, height: 900 });
  await toEditor(page, api);
  await expect.poll(() => tOf(page)).toEqual(fin.transform);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'real-editor-1440.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'real-editor-375.png') });
});
