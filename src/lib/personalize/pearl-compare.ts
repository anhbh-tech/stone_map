// Client HTTP của pearl_compare (engine ảnh: template theo theme, cutout pearl, cảnh theo khách, render final).
// Hợp đồng: docs/OUTPUT.md của pearl_compare. Prompt và model nằm hết ở pearl_compare; ở đây chỉ có tham số request.
import type { PetTransform, Pt } from './contract';

/** Template thô như GET /api/templates/<theme> trả (chỉ các trường pearl_store dùng). */
export type PcTemplate = {
  theme: string; rev: string; kind?: 'scene';
  size: { w: number; h: number };
  quad: [Pt, Pt, Pt, Pt]; clip: Pt[];
  canvasBgInfo?: { w: number; h: number } | null;
  realPet?: boolean;
  urls: { base: string; overlay: string; mask?: string | null; empty?: string | null; canvasBg?: string | null };
};
export type PcStep = { id: number; stage: string; status: 'running' | 'done' | 'error'; error?: string; provider?: string; model?: string };
export type PcCutout = {
  provider: string; model: string; art: string; cutout: string; w: number; h: number; bottomCut?: boolean;
  pass: boolean; why: string[]; transform: PetTransform | null; template: string | null; final: string | null;
};
export type PcJob = {
  id: string; status: 'running' | 'done' | 'error'; error?: string; progress: number; theme: string; ref?: string;
  notes?: string[]; steps: PcStep[]; cutouts: PcCutout[];
  scene?: { art?: string; pass: boolean; why: string[]; template: string | null; reused?: boolean };
  template: { theme: string; rev: string; kind: 'scene' | 'theme'; size: PcTemplate['size']; quad: PcTemplate['quad']; clip: Pt[]; urls: PcTemplate['urls'] } | null;
};
/** Dòng history final (POST /api/render, GET /api/finals). */
export type PcFinal = {
  files?: string[]; final?: string; cutout: string | null; template: string | null; transform: PetTransform | null;
  pass?: boolean | null; why?: string[]; sceneImage?: string | null; job?: string | null; theme?: string;
};
export type CutoutBody = { theme: string; refImage: string; provider?: string; modelId?: string; maxFixes?: number; scene?: boolean; outfitRef?: boolean };
export type RenderReq = { theme: string; cutout: string; transform: PetTransform; rev: string; job?: string | null };

export type PcErrorCode = 'unavailable' | 'timeout' | 'not_found' | 'rejected' | 'error';
export class PcError extends Error {
  constructor(readonly code: PcErrorCode, message: string, readonly status?: number) { super(message); }
}

/** Mặt giao tiếp worker + route dùng; bản HTTP ở dưới, bản offline ở ./pc-mock.ts. */
export interface PcClient {
  readonly name: 'pearl_compare' | 'mock';
  template(theme: string, rev?: string | null): Promise<PcTemplate>;
  startCutout(body: CutoutBody): Promise<PcJob>;
  /** null = pearl_compare không còn job này (đã khởi động lại). */
  job(id: string): Promise<PcJob | null>;
  finals(jobId: string): Promise<PcFinal[]>;
  render(body: RenderReq): Promise<PcFinal>;
  /** Tải 1 file của pearl_compare theo đường dẫn tương đối `outputs/<f>` hoặc `outputs/templates/<f>`. */
  asset(rel: string): Promise<{ buf: Buffer; mime: string }>;
}

/**
 * Tham số request cutout: một chỗ duy nhất, giống lượt rollout 016–024 (rollout.mjs / regen.mjs của pearl_compare):
 * fal gemini-3-pro-image-preview/edit (2K do CUTOUT_RESOLUTION của pearl_compare), sửa tối đa 1 lần, có cảnh theo khách,
 * royal-starry không gửi outfitRef (outfitRef của theme là bản trước v5). Ghi đè bằng env khi cần.
 */
export function pcConfig(env: Record<string, string | undefined> = process.env) {
  const [provider, ...rest] = (env.PEARL_COMPARE_CUTOUT_MODEL || 'fal:fal-ai/gemini-3-pro-image-preview/edit').split(':');
  return {
    url: (env.PEARL_COMPARE_URL || 'http://localhost:5177').replace(/\/+$/, ''),
    provider,
    modelId: rest.join(':'),
    maxFixes: 1,
    scene: true,
    noOutfitRef: ['royal-starry'] as string[],
    pollMs: 1500,
    requestTimeoutMs: 30_000,
  };
}
export type PcConfig = ReturnType<typeof pcConfig>;

export function cutoutBody(theme: string, refImage: string, cfg: PcConfig = pcConfig()): CutoutBody {
  return {
    theme, refImage, provider: cfg.provider, modelId: cfg.modelId, maxFixes: cfg.maxFixes, scene: cfg.scene,
    ...(cfg.noOutfitRef.includes(theme) ? { outfitRef: false } : {}),
  };
}

/** `outputs/…` hợp lệ: 1 tầng file, hoặc templates/<file>. Không "..", không ký tự lạ. */
const SEG = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
export function safeOutputsRel(rel: string): string | null {
  const segs = rel.replace(/^\/+/, '').split('/');
  if (segs[0] !== 'outputs' || segs.some((s) => !SEG.test(s) || s.includes('..'))) return null;
  if (segs.length === 2 || (segs.length === 3 && segs[1] === 'templates')) return segs.join('/');
  return null;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export const mimeOf = (file: string) => MIME[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export function httpClient(cfg: PcConfig = pcConfig(), fetchImpl: typeof fetch = fetch): PcClient {
  async function call<T>(p: string, init: RequestInit = {}, timeoutMs = cfg.requestTimeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(cfg.url + p, { signal: AbortSignal.timeout(timeoutMs), ...init });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new PcError(timeout ? 'timeout' : 'unavailable', timeout ? `pearl_compare did not answer ${p} in ${timeoutMs} ms` : `pearl_compare unreachable at ${cfg.url}: ${e instanceof Error ? e.message : e}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* không phải JSON */ }
    if (!res.ok) {
      const msg = (body as { error?: string })?.error || String(text).slice(0, 200) || `HTTP ${res.status}`;
      const code: PcErrorCode = res.status === 404 ? 'not_found' : res.status >= 500 ? 'error' : 'rejected';
      throw new PcError(code, `pearl_compare ${p}: ${msg}`.slice(0, 400), res.status);
    }
    return body as T;
  }
  const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    name: 'pearl_compare',
    template: (theme, rev) => call<PcTemplate>(`/api/templates/${encodeURIComponent(theme)}${rev ? `?rev=${encodeURIComponent(rev)}` : ''}`),
    startCutout: (body) => call<PcJob>('/api/cutout', post(body), 120_000),
    async job(id) {
      try { return await call<PcJob>(`/api/cutout/${encodeURIComponent(id)}`); } catch (e) {
        if (e instanceof PcError && e.code === 'not_found') return null;
        throw e;
      }
    },
    finals: (jobId) => call<PcFinal[]>(`/api/finals?job=${encodeURIComponent(jobId)}&all=1`),
    render: (body) => call<PcFinal>('/api/render', post(body), 120_000),
    async asset(rel) {
      const safe = safeOutputsRel(rel);
      if (!safe) throw new PcError('rejected', `not a pearl_compare output path: ${rel}`);
      let res: Response;
      try { res = await fetchImpl(`${cfg.url}/${safe}`, { signal: AbortSignal.timeout(60_000) }); } catch (e) {
        throw new PcError('unavailable', `pearl_compare unreachable at ${cfg.url}: ${e instanceof Error ? e.message : e}`);
      }
      if (!res.ok) throw new PcError(res.status === 404 ? 'not_found' : 'error', `pearl_compare /${safe}: HTTP ${res.status}`, res.status);
      return { buf: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || mimeOf(safe) };
    },
  };
}

/** `/outputs/x.png` hoặc `/outputs/templates/x.png` → `outputs/…` (null nếu không phải đường dẫn outputs). */
export const outputsRel = (url: string | null | undefined): string | null => (url ? safeOutputsRel(url.replace(/^https?:\/\/[^/]+/, '')) : null);
