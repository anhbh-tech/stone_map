// pearl_compare giả lập, chạy offline (settings.ai.provider = 'mock': dev, e2e, test). Cùng PcClient với bản HTTP:
// template theo theme (lớp vẽ bằng sharp), job cutout có progress theo settings.ai.mock_ms, render final thật theo
// transform (base → canvasBg → pet cắt theo clip → overlay). Không gọi model nào. File nằm ở storage/pc-mock/outputs/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { STORAGE } from '../db';
import { PC_THEMES, type PetTransform, type Pt } from './contract';
import { mimeOf, PcError, safeOutputsRel, type PcClient, type PcCutout, type PcFinal, type PcJob, type PcTemplate, type RenderReq } from './pearl-compare';

const W = 1024, H = 1024;
const QUAD: [Pt, Pt, Pt, Pt] = [[322, 192], [702, 192], [702, 762], [322, 762]];
const CLIP: Pt[] = [[320, 190], [704, 190], [704, 764], [320, 764]];
export const MOCK_REV = 'mock-v1';
const DEMO: Record<string, string> = { 'royal-starry': 'starry-king', 'sunflower-queen': 'sunflower-queen', 'cafe-duke': 'cafe-duke' };
const WALL: Record<string, [string, string]> = { 'royal-starry': ['#22305a', '#121a33'], 'sunflower-queen': ['#e9c46a', '#b9862f'], 'cafe-duke': ['#5a3a22', '#2c1c10'] };
const CUT_W = 600, CUT_H = 720;

const dir = () => path.join(STORAGE, 'pc-mock', 'outputs');
const tdir = () => path.join(dir(), 'templates');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);
const poly = (pts: Pt[]) => pts.map((p) => p.join(',')).join(' ');
const bbox = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const demoFile = (theme: string) => path.join(process.cwd(), 'public', 'demo', `${DEMO[theme] ?? 'starry-king'}.webp`);

/** Như innerRect + defaultTransform của pearl_compare (public/layers.js): trọn trong canvas, canh giữa, đáy chạm đáy. */
export function mockDefaultTransform(quad: [Pt, Pt, Pt, Pt], pw: number, ph: number): PetTransform {
  const [tl, tr, br, bl] = quad;
  const x0 = Math.max(tl[0], bl[0]), y0 = Math.max(tl[1], tr[1]), x1 = Math.min(tr[0], br[0]), y1 = Math.min(bl[1], br[1]);
  const s = Math.min((x1 - x0) / pw, (y1 - y0) / ph);
  return { x: r3((x0 + x1) / 2), y: r3(y1 - (ph * s) / 2), scale: r3(s), rotate: 0 };
}

/** Như normTransform của pearl_compare: kẹp x, y vào hình chữ nhật trong của quad, scale [0.01, 20], rotate (−180, 180]. */
export function normTransform(t: PetTransform, quad: [Pt, Pt, Pt, Pt]): PetTransform {
  const [tl, tr, br, bl] = quad;
  const x0 = Math.max(tl[0], bl[0]), y0 = Math.max(tl[1], tr[1]), x1 = Math.min(tr[0], br[0]), y1 = Math.min(bl[1], br[1]);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  let rot = ((Number(t.rotate) || 0) % 360 + 360) % 360;
  if (rot > 180) rot -= 360;
  return { x: r3(clamp(t.x, x0, x1)), y: r3(clamp(t.y, y0, y1)), scale: r3(clamp(t.scale, 0.01, 20)), rotate: r3(rot === -180 ? 180 : rot) };
}

function templateJson(theme: string): PcTemplate {
  const f = (k: string) => `${theme}_${MOCK_REV}_${k}.png`;
  const u = (k: string) => `/outputs/templates/${f(k)}`;
  const b = bbox(CLIP);
  return {
    theme, rev: MOCK_REV, size: { w: W, h: H }, quad: QUAD, clip: CLIP,
    canvasBgInfo: { w: Math.ceil(b.x1 - b.x0) + 2, h: Math.ceil(b.y1 - b.y0) + 2 },
    urls: { base: u('base'), overlay: u('overlay'), mask: u('mask'), empty: u('empty'), canvasBg: u('canvasBg') },
  };
}

async function ensureTemplate(theme: string): Promise<PcTemplate> {
  const t = templateJson(theme);
  const file = (k: keyof PcTemplate['urls']) => path.join(dir(), '..', t.urls[k]!);
  if (fs.existsSync(file('empty'))) return t;
  fs.mkdirSync(tdir(), { recursive: true });
  const [c0, c1] = WALL[theme] ?? WALL['royal-starry'];
  const base = await sharp(svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/><rect x="0" y="860" width="${W}" height="164" fill="#3b2f25"/>
    <polygon points="${poly(QUAD)}" fill="#efe6d4"/>`)).png().toBuffer();
  // Overlay: viền khung vàng đục quanh quad + bóng mép trong suốt một phần; trong canvas trong suốt.
  const [tl, , br] = QUAD, fw = 30;
  const overlay = await sharp(svg(`<path fill-rule="evenodd" fill="#b8913a" d="M${tl[0] - fw},${tl[1] - fw}H${br[0] + fw}V${br[1] + fw}H${tl[0] - fw}Z M${tl[0]},${tl[1]}V${br[1]}H${br[0]}V${tl[1]}Z"/>
    <rect x="${tl[0]}" y="${tl[1]}" width="${br[0] - tl[0]}" height="${br[1] - tl[1]}" fill="none" stroke="#000" stroke-opacity="0.28" stroke-width="8"/>`)).png().toBuffer();
  const mask = await sharp(svg(`<polygon points="${poly(QUAD)}" fill="#fff"/>`)).png().toBuffer();
  const empty = await sharp(base).composite([{ input: overlay }]).png().toBuffer();
  const bg = t.canvasBgInfo!;
  const canvasBg = await sharp(demoFile(theme)).resize(bg.w, bg.h, { fit: 'cover' }).modulate({ brightness: 0.8, saturation: 0.6 }).blur(6).png().toBuffer();
  for (const [k, buf] of [['base', base], ['overlay', overlay], ['mask', mask], ['canvasBg', canvasBg], ['empty', empty]] as const) {
    fs.writeFileSync(file(k), buf);
  }
  return t;
}

/** Ảnh RGBA W×H chỉ giữ phần trong đa giác clip. */
async function clipTo(layer: Buffer, clip: Pt[]): Promise<Buffer> {
  return sharp(layer).composite([{ input: svg(`<polygon points="${poly(clip)}" fill="#fff"/>`), blend: 'dest-in' }]).png().toBuffer();
}

/** Đặt ảnh `img` (tâm cx, cy) lên nền trong suốt W×H, cắt phần ra ngoài. */
async function place(img: Buffer, cx: number, cy: number): Promise<Buffer> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const left = Math.round(cx - info.width / 2), top = Math.round(cy - info.height / 2);
  const sx = Math.max(0, -left), sy = Math.max(0, -top);
  const dx = Math.max(0, left), dy = Math.max(0, top);
  const w = Math.min(info.width - sx, W - dx), h = Math.min(info.height - sy, H - dy);
  const blank = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (w <= 0 || h <= 0) return blank.png().toBuffer();
  const part = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left: sx, top: sy, width: w, height: h }).png().toBuffer();
  return blank.composite([{ input: part, left: dx, top: dy }]).png().toBuffer();
}

/** Final theo lớp: base → canvasBg (phủ bbox clip) → pet (transform) — cả hai cắt theo clip — → overlay. */
export async function composeFinal(t: PcTemplate, files: { base: Buffer; overlay: Buffer; canvasBg: Buffer | null }, cut: Buffer, tr: PetTransform): Promise<Buffer> {
  const layers: OverlayOptions[] = [];
  if (files.canvasBg) {
    const b = bbox(t.clip), bw = Math.round(b.x1 - b.x0) + 2, bh = Math.round(b.y1 - b.y0) + 2;
    const bg = await sharp(files.canvasBg).resize(bw, bh, { fit: 'cover' }).png().toBuffer();
    layers.push({ input: await clipTo(await place(bg, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), t.clip) });
  }
  const meta = await sharp(cut).metadata();
  const sw = Math.max(1, Math.round((meta.width ?? 1) * tr.scale)), sh = Math.max(1, Math.round((meta.height ?? 1) * tr.scale));
  const pet = await sharp(cut).resize(sw, sh).rotate(tr.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  layers.push({ input: await clipTo(await place(pet, tr.x, tr.y), t.clip) });
  layers.push({ input: files.overlay });
  return sharp(files.base).composite(layers).jpeg({ quality: 90 }).toBuffer();
}

type MockJob = { id: string; theme: string; start: number; ms: number; ref: string; result: PcJob | null };
const g = globalThis as typeof globalThis & { __pcMockJobs?: Map<string, MockJob> };
const jobs = () => (g.__pcMockJobs ??= new Map());

/** Bước + progress như pearl_compare (OUTPUT.md §3): phân tích 10%, rồi cảnh và cutout song song, rồi final. */
function stepsAt(f: number): { progress: number; steps: PcJob['steps'] } {
  const st = (id: number, stage: string, from: number, to: number) =>
    f >= from ? { id, stage, status: f >= to ? 'done' as const : 'running' as const, provider: 'mock', model: 'mock-pearl' } : null;
  const steps = [st(1, 'analyze', 0, 0.15), st(2, 'scene', 0.15, 0.7), st(3, 'cutout', 0.15, 0.8), st(4, 'final', 0.8, 1)].filter((s) => s !== null);
  return { progress: Math.min(0.99, r3(0.1 * Math.min(1, f / 0.15) + 0.9 * Math.max(0, (f - 0.15) / 0.85))), steps };
}

async function ensureCutout(theme: string): Promise<string> {
  const name = `mock_${theme}.cut.png`, file = path.join(dir(), name);
  if (fs.existsSync(file)) return name;
  fs.mkdirSync(dir(), { recursive: true });
  const ell = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CUT_W}" height="${CUT_H}"><ellipse cx="${CUT_W / 2}" cy="${CUT_H * 0.55}" rx="${CUT_W * 0.46}" ry="${CUT_H * 0.45}" fill="#fff"/></svg>`);
  const buf = await sharp(demoFile(theme)).resize(CUT_W, CUT_H, { fit: 'cover' }).ensureAlpha().composite([{ input: ell, blend: 'dest-in' }]).png().toBuffer();
  fs.writeFileSync(file, buf);
  return name;
}

async function render(b: RenderReq, job: string | null): Promise<PcFinal> {
  if (!(PC_THEMES as readonly string[]).includes(b.theme)) throw new PcError('not_found', `Theme ${b.theme} chưa có template`, 404);
  if (b.rev !== MOCK_REV) throw new PcError('not_found', `Theme ${b.theme} chưa có template rev ${b.rev}`, 404);
  const cutRel = safeOutputsRel(`outputs/${b.cutout}`);
  if (!cutRel || !b.cutout.endsWith('.cut.png') || !fs.existsSync(path.join(dir(), b.cutout))) throw new PcError('rejected', 'Thiếu cutout (file .cut.png trong outputs)', 400);
  const t = await ensureTemplate(b.theme);
  const read = (u: string | null | undefined) => (u ? fs.readFileSync(path.join(dir(), '..', u)) : null);
  const transform = normTransform(b.transform, t.quad);
  const buf = await composeFinal(t, { base: read(t.urls.base)!, overlay: read(t.urls.overlay)!, canvasBg: read(t.urls.canvasBg) }, fs.readFileSync(path.join(dir(), b.cutout)), transform);
  const name = `mock_${Date.now()}_${crypto.randomBytes(3).toString('hex')}_final_${b.theme}.jpg`;
  fs.writeFileSync(path.join(dir(), name), buf);
  return { files: [name], cutout: b.cutout, template: t.rev, transform, pass: true, why: [], sceneImage: null, job: b.job ?? job, theme: b.theme };
}

export function mockClient(opts: { ms: number }): PcClient {
  return {
    name: 'mock',
    async template(theme, rev) {
      if (!(PC_THEMES as readonly string[]).includes(theme) || (rev && rev !== MOCK_REV)) throw new PcError('not_found', `Theme ${theme} chưa có template`, 404);
      return ensureTemplate(theme);
    },
    async startCutout(body) {
      if (!(PC_THEMES as readonly string[]).includes(body.theme)) throw new PcError('rejected', `Theme ${body.theme} không có template / cutout`, 400);
      if (!/^data:image\//.test(body.refImage)) throw new PcError('rejected', 'Thiếu ảnh pet (refImage)', 400);
      const id = `job-mock${crypto.randomBytes(5).toString('hex')}`;
      const ref = `ref_${crypto.createHash('sha1').update(body.refImage).digest('hex').slice(0, 12)}.jpg`;
      jobs().set(id, { id, theme: body.theme, start: Date.now(), ms: Math.max(0, opts.ms), ref, result: null });
      return (await this.job(id))!;
    },
    async job(id) {
      const j = jobs().get(id);
      if (!j) return null;
      if (j.result) return j.result;
      const f = j.ms <= 0 ? 1 : (Date.now() - j.start) / j.ms;
      const base = { id, theme: j.theme, ref: j.ref, notes: [], cutouts: [] as PcCutout[], template: null };
      if (f < 1) return { ...base, status: 'running', ...stepsAt(f) };
      const t = await ensureTemplate(j.theme);
      const cutout = await ensureCutout(j.theme);
      const transform = mockDefaultTransform(t.quad, CUT_W, CUT_H);
      const fin = await render({ theme: j.theme, cutout, transform, rev: t.rev, job: id }, id);
      j.result = {
        ...base, status: 'done', progress: 1, steps: stepsAt(1).steps.map((s) => ({ ...s, status: 'done' })),
        scene: { pass: false, why: ['mock: không gen cảnh theo khách'], template: null },
        template: { theme: t.theme, rev: t.rev, kind: 'theme', size: t.size, quad: t.quad, clip: t.clip, urls: t.urls },
        cutouts: [{ provider: 'mock', model: 'mock-pearl', art: `mock_${j.theme}.png`, cutout, w: CUT_W, h: CUT_H, bottomCut: false, pass: true, why: [], transform, template: t.rev, final: fin.files![0] }],
      };
      return j.result;
    },
    async finals(jobId) {
      const r = jobs().get(jobId)?.result?.cutouts[0];
      return r?.final ? [{ final: r.final, cutout: r.cutout, template: r.template, transform: r.transform, pass: true, why: [], job: jobId }] : [];
    },
    render: (b) => render(b, b.job ?? null),
    async asset(rel) {
      const safe = safeOutputsRel(rel);
      if (!safe) throw new PcError('rejected', `not a pearl_compare output path: ${rel}`);
      const segs = safe.split('/');
      if (segs[1] === 'templates') {
        const theme = PC_THEMES.find((th) => segs[2].startsWith(`${th}_`));
        if (theme) await ensureTemplate(theme);
      }
      const file = path.join(dir(), '..', safe);
      if (!fs.existsSync(file)) throw new PcError('not_found', `/${safe}: HTTP 404`, 404);
      return { buf: fs.readFileSync(file), mime: mimeOf(safe) };
    },
  };
}
