// Adapter pearl_store ↔ pearl_compare: chọn client, map sản phẩm → theme, đổi template sang TemplateView (url proxy
// cùng origin), nhập kết quả job cutout và render lại final khi khách bấm OK. Ảnh final + cutout được chép về storage/
// để giỏ, đơn, admin và file in không phụ thuộc pearl_compare còn chạy hay không.
import { db, json } from '../db';
import type { Settings } from '../types';
import { PC_THEMES, type PetTransform, type TemplateView } from './contract';
import { getDesign, nowIso, type DesignRow } from './designs';
import { httpClient, outputsRel, PcError, type PcClient, type PcCutout, type PcJob, type PcTemplate } from './pearl-compare';
import { mockClient } from './pc-mock';
import { renderMockup, renderPreview } from './render';
import { removeStored, writeStored } from './storage';

/** designs.pc (JSON). Mọi thứ cần để hiện lại editor và render lại final ở pearl_compare. */
export type PcMeta = {
  theme: string;
  engine: PcClient['name'];
  job: string | null;                      // id job ở pearl_compare
  rev: string;                             // rev template của final (gửi lại khi render)
  cutout_file: string;                     // tên .cut.png ở pearl_compare (render lại)
  cutout: { w: number; h: number; default_transform: PetTransform; bottom_cut: boolean };
  template: TemplateView;
  transform: PetTransform;
  final_file: string;                      // tên final ở pearl_compare
  pass: boolean | null;
  why: string[];
  scene: boolean;
  rendered_at: string;
};

const g = globalThis as typeof globalThis & { __pcClientOverride?: PcClient | null };
/** Chỉ cho test: thay client của mọi route / worker trong process này. */
export const setClientOverride = (c: PcClient | null) => { g.__pcClientOverride = c; };

/** provider 'mock' (mặc định seed, dev, e2e) → pearl_compare giả lập, không tốn tiền; còn lại → pearl_compare thật. */
export function engineFor(s: Settings): PcClient {
  if (g.__pcClientOverride) return g.__pcClientOverride;
  return s.ai.provider === 'mock' ? mockClient({ ms: s.ai.mock_ms }) : httpClient();
}
export const engineName = (s: Settings): PcClient['name'] => (s.ai.provider === 'mock' ? 'mock' : 'pearl_compare');

export const isPcTheme = (t: string | null | undefined): t is string => !!t && (PC_THEMES as readonly string[]).includes(t);

/** Theme của sản phẩm: tag `style:<theme>` (scripts/seed-themes.ts). null = sản phẩm không có theme pearl_compare. */
export function themeForProduct(productId: number): string | null {
  const rows = db().prepare("SELECT tag FROM product_tags WHERE product_id = ? AND tag LIKE 'style:%' ORDER BY tag").all(productId) as { tag: string }[];
  return rows.map((r) => r.tag.slice(6)).find(isPcTheme) ?? null;
}

/** `/outputs/…` của pearl_compare → URL proxy cùng origin. */
export const proxied = (url: string | null | undefined): string | null => {
  const rel = outputsRel(url);
  return rel ? `/api/personalize/pc/${rel}` : null;
};

type RawTemplate = Pick<PcTemplate, 'theme' | 'rev' | 'size' | 'quad' | 'clip' | 'urls'> & { kind?: string; canvasBgInfo?: PcTemplate['canvasBgInfo'] };
export function toTemplateView(t: RawTemplate): TemplateView {
  return {
    theme: t.theme,
    rev: t.rev,
    kind: t.kind === 'scene' ? 'scene' : 'theme',
    size: t.size,
    quad: t.quad,
    clip: t.clip,
    canvas_bg: t.urls.canvasBg && t.canvasBgInfo ? { w: t.canvasBgInfo.w, h: t.canvasBgInfo.h } : null,
    urls: {
      base: proxied(t.urls.base)!,
      canvas_bg: proxied(t.urls.canvasBg),
      overlay: proxied(t.urls.overlay)!,
      mask: proxied(t.urls.mask),
      empty: proxied(t.urls.empty),
    },
  };
}

const cache = new Map<string, { at: number; view: TemplateView }>();
const TTL_CURRENT = 60_000, TTL_REV = 3_600_000;
/** Template (bản đang dùng, hoặc 1 rev) dạng TemplateView. Ném PcError (not_found / unavailable / timeout / …). */
export async function templateView(client: PcClient, theme: string, rev?: string | null, now = Date.now()): Promise<TemplateView> {
  const k = `${client.name}|${theme}|${rev ?? ''}`;
  const hit = cache.get(k);
  if (hit && now - hit.at < (rev ? TTL_REV : TTL_CURRENT)) return hit.view;
  const view = toTemplateView(await client.template(theme, rev));
  if (cache.size > 200) cache.clear();
  cache.set(k, { at: now, view });
  return view;
}
export const clearTemplateCache = () => cache.clear();

export const pcMetaOf = (d: Pick<DesignRow, 'pc'>) => json<PcMeta | null>(d.pc, null);

/** Cutout tốt nhất có final (pearl_compare xếp tốt nhất trước). */
export const bestCutout = (j: PcJob): PcCutout | null => j.cutouts.find((c) => !!c.final && !!c.cutout) ?? null;

/** Lý do job pearl_compare không cho final (ghi log / admin). */
export function noFinalReason(j: PcJob): string {
  return [j.error, ...(j.notes ?? []), ...j.steps.filter((s) => s.status === 'error').map((s) => `${s.stage}: ${s.error ?? 'error'}`)].filter(Boolean).join('; ') || 'pearl_compare returned no final';
}

type Stored = { source_path: string; preview_path: string; mockup_path: string };
async function storeFinal(designId: string, tag: string, final: { buf: Buffer; mime: string }): Promise<Stored> {
  const ext = final.mime === 'image/png' ? 'png' : 'jpg';
  const [preview, mockup] = await Promise.all([renderPreview(final.buf), renderMockup(final.buf)]);
  return {
    source_path: writeStored('generated', `${designId}-${tag}.${ext}`, final.buf),
    preview_path: writeStored('previews', `${designId}-${tag}.webp`, preview),
    mockup_path: writeStored('mockups', `${designId}-${tag}.webp`, mockup),
  };
}

export type Imported = Stored & { cutout_path: string; pc: string; transform: string };

/** Job pearl_compare đã xong → chép final + cutout về storage, dựng PcMeta. Ném PcError nếu không có final. */
export async function importJob(client: PcClient, designId: string, tag: string, j: PcJob): Promise<Imported> {
  const c = bestCutout(j);
  if (!c || !j.template) throw new PcError('error', noFinalReason(j));
  // Template đầy đủ (có canvasBgInfo) của đúng rev; lỗi thì dùng bản rút gọn trong job.
  const full = await client.template(j.theme, j.template.rev).catch(() => null);
  const template = toTemplateView({ ...j.template, ...(full ?? {}), kind: j.template.kind });
  const [final, cut] = await Promise.all([client.asset(`outputs/${c.final}`), client.asset(`outputs/${c.cutout}`)]);
  const transform = c.transform ?? { x: template.size.w / 2, y: template.size.h / 2, scale: 1, rotate: 0 };
  const files = await storeFinal(designId, tag, final);
  const cutout_path = writeStored('cutouts', `${designId}-${tag}.png`, cut.buf);
  const meta: PcMeta = {
    theme: j.theme, engine: client.name, job: j.id, rev: j.template.rev, cutout_file: c.cutout,
    cutout: { w: c.w, h: c.h, default_transform: transform, bottom_cut: !!c.bottomCut },
    template, transform, final_file: c.final!, pass: typeof c.pass === 'boolean' ? c.pass : null, why: c.why ?? [],
    scene: j.template.kind === 'scene', rendered_at: nowIso(),
  };
  return { ...files, cutout_path, pc: JSON.stringify(meta), transform: JSON.stringify(transform) };
}

export class NotReadyError extends Error {}

/** Khách bấm OK: pearl_compare render final mới theo transform; lưu final + transform (đã chuẩn hoá) vào design. */
export async function renderDesign(client: PcClient, d: DesignRow, transform: PetTransform): Promise<DesignRow> {
  const meta = pcMetaOf(d);
  if (!meta || d.status !== 'ready') throw new NotReadyError(d.status === 'confirmed' ? 'This design is already confirmed.' : 'Your preview is not ready yet.');
  const row = await client.render({ theme: meta.theme, cutout: meta.cutout_file, transform, rev: meta.rev, job: meta.job });
  const file = row.files?.[0] ?? row.final;
  if (!file) throw new PcError('error', 'pearl_compare render returned no file');
  const final = await client.asset(`outputs/${file}`);
  const tag = `r${Date.now().toString(36)}`;
  const files = await storeFinal(d.id, tag, final);
  const t = row.transform ?? transform;
  const next: PcMeta = {
    ...meta, transform: t, final_file: file, rendered_at: nowIso(),
    pass: typeof row.pass === 'boolean' ? row.pass : meta.pass, why: row.why ?? meta.why,
  };
  const r = db().prepare(`UPDATE designs SET source_path = ?, preview_path = ?, mockup_path = ?, print_path = NULL, transform = ?, pc = ?, updated_at = ?
    WHERE id = ? AND status = 'ready'`).run(files.source_path, files.preview_path, files.mockup_path, JSON.stringify(t), JSON.stringify(next), nowIso(), d.id);
  if (!r.changes) {
    Object.values(files).forEach(removeStored);
    throw new NotReadyError('This design changed while rendering. Please try again.');
  }
  for (const k of ['source_path', 'preview_path', 'mockup_path', 'print_path'] as const) removeStored(d[k]);
  return getDesign(d.id)!;
}
