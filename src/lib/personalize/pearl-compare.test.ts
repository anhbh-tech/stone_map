import { describe, expect, it } from 'vitest';
import { cutoutBody, httpClient, outputsRel, pcConfig, PcError, safeOutputsRel } from './pearl-compare';
import { mockDefaultTransform, normTransform } from './pc-mock';
import { proxied, toTemplateView } from './engine';

describe('pcConfig / cutoutBody', () => {
  it('mirrors the rollout request: fal gemini-3-pro edit, 1 fix, scene on, no outfitRef for royal-starry', () => {
    const cfg = pcConfig({});
    expect(cfg.url).toBe('http://localhost:5177');
    expect(cutoutBody('royal-starry', 'data:x', cfg)).toEqual({
      theme: 'royal-starry', refImage: 'data:x', provider: 'fal', modelId: 'fal-ai/gemini-3-pro-image-preview/edit', maxFixes: 1, scene: true, outfitRef: false,
    });
    expect(cutoutBody('sunflower-queen', 'data:x', cfg)).not.toHaveProperty('outfitRef');
  });
  it('reads PEARL_COMPARE_URL and PEARL_COMPARE_CUTOUT_MODEL from env', () => {
    const cfg = pcConfig({ PEARL_COMPARE_URL: 'http://pc:9000/', PEARL_COMPARE_CUTOUT_MODEL: 'gemini:gemini-x:edit' });
    expect(cfg).toMatchObject({ url: 'http://pc:9000', provider: 'gemini', modelId: 'gemini-x:edit' });
  });
});

describe('output paths', () => {
  it('accepts only outputs/<file> and outputs/templates/<file>', () => {
    expect(safeOutputsRel('/outputs/templates/royal-starry_r_base.png')).toBe('outputs/templates/royal-starry_r_base.png');
    expect(safeOutputsRel('outputs/a.cut.png')).toBe('outputs/a.cut.png');
    for (const bad of ['outputs/../x.png', 'outputs/templates/../../etc', 'public/x.png', 'outputs/a/b/c.png', 'outputs/.env', 'outputs/']) expect(safeOutputsRel(bad), bad).toBeNull();
    expect(outputsRel('http://localhost:5177/outputs/x.png')).toBe('outputs/x.png');
    expect(proxied('/outputs/templates/t.png')).toBe('/api/personalize/pc/outputs/templates/t.png');
    expect(proxied(null)).toBeNull();
  });
  it('turns a template into a same-origin TemplateView', () => {
    const v = toTemplateView({
      theme: 'royal-starry', rev: 'r1', kind: 'scene', size: { w: 1024, h: 1024 }, quad: [[1, 2], [3, 4], [5, 6], [7, 8]], clip: [[0, 0]],
      canvasBgInfo: { w: 400, h: 600 },
      urls: { base: '/outputs/templates/b.png', overlay: '/outputs/templates/o.png', mask: null, empty: null, canvasBg: '/outputs/templates/c.png' },
    });
    expect(v).toMatchObject({ kind: 'scene', canvas_bg: { w: 400, h: 600 }, urls: { base: '/api/personalize/pc/outputs/templates/b.png', empty: null, canvas_bg: '/api/personalize/pc/outputs/templates/c.png' } });
  });
});

describe('httpClient', () => {
  const fake = (h: (url: string, init?: RequestInit) => Response | Promise<Response>) => (async (u: string | URL | Request, i?: RequestInit) => h(String(u), i)) as typeof fetch;
  it('posts the cutout body and parses the job', async () => {
    let seen: { url: string; body: unknown } | null = null;
    const c = httpClient(pcConfig({ PEARL_COMPARE_URL: 'http://pc' }), fake((url, init) => {
      seen = { url, body: JSON.parse(String(init?.body)) };
      return Response.json({ id: 'job-1', status: 'running', progress: 0.1, steps: [], cutouts: [] });
    }));
    const j = await c.startCutout(cutoutBody('cafe-duke', 'data:x'));
    expect(j.id).toBe('job-1');
    expect(seen).toMatchObject({ url: 'http://pc/api/cutout', body: { theme: 'cafe-duke', maxFixes: 1 } });
  });
  it('maps failures to PcError codes; a lost job is null', async () => {
    const down = httpClient(pcConfig({}), fake(() => { throw new TypeError('fetch failed'); }));
    await expect(down.template('royal-starry')).rejects.toMatchObject({ code: 'unavailable' });
    const notFound = httpClient(pcConfig({}), fake(() => Response.json({ error: 'Không có job' }, { status: 404 })));
    expect(await notFound.job('job-x')).toBeNull();
    await expect(notFound.template('nope')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    const bad = httpClient(pcConfig({}), fake(() => Response.json({ error: 'Thiếu ảnh pet' }, { status: 400 })));
    await expect(bad.startCutout(cutoutBody('cafe-duke', ''))).rejects.toMatchObject({ code: 'rejected' });
    const boom = httpClient(pcConfig({}), fake(() => new Response('oops', { status: 500 })));
    await expect(boom.render({ theme: 't', cutout: 'a.cut.png', transform: { x: 0, y: 0, scale: 1, rotate: 0 }, rev: 'r' })).rejects.toBeInstanceOf(PcError);
    await expect(boom.asset('outputs/../../x')).rejects.toMatchObject({ code: 'rejected' });
  });
  it('downloads an asset with its mime type', async () => {
    const c = httpClient(pcConfig({ PEARL_COMPARE_URL: 'http://pc' }), fake((url) => {
      expect(url).toBe('http://pc/outputs/templates/a.png');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }));
    expect(await c.asset('outputs/templates/a.png')).toMatchObject({ mime: 'image/png' });
  });
});

describe('transforms (as pearl_compare public/layers.js)', () => {
  const quad: [[number, number], [number, number], [number, number], [number, number]] = [[100, 100], [500, 100], [500, 700], [100, 700]];
  it('default transform fits the whole cutout and sits on the canvas bottom', () => {
    const t = mockDefaultTransform(quad, 400, 300);
    expect(t).toEqual({ x: 300, y: 550, scale: 1, rotate: 0 });
  });
  it('normTransform clamps centre, scale and rotation', () => {
    expect(normTransform({ x: -5, y: 9999, scale: 50, rotate: 190 }, quad)).toEqual({ x: 100, y: 700, scale: 20, rotate: -170 });
    expect(normTransform({ x: 200, y: 200, scale: 0.5, rotate: -180 }, quad).rotate).toBe(180);
  });
});
