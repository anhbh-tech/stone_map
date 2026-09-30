// Provider AI cho worker: analyze (đặc điểm màu) → generate (ảnh pearl) → check (judge ảnh ra).
// mock: chạy offline, trả ảnh mẫu public/demo/*.webp sau settings.ai.mock_ms. gemini / openai: port từ pearl_compare/server.js.
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../types';
import { geminiImage, geminiJson, geminiKey, imagePart, openaiImage, type Img } from './ai';
import { buildPrompt, featuresBlock, laneOf, withFeatures, type Analysis } from './prompts';

export type Judge = { strands: boolean; nose_pearls: boolean; real_fur: boolean; uneven: 'none' | 'few' | 'many'; broken: 'none' | 'few' | 'many'; note: string };
export type CheckResult = { pass: boolean; why: string[]; judge: Judge | null; skipped: string | null };

export type Provider = {
  name: Settings['ai']['provider'];
  model: string;
  analyze(ref: Img): Promise<Analysis | null>;
  generate(input: { style: string | null; ref: Img; analysis: Analysis | null; attempt: number }): Promise<Img>;
  check(img: Img): Promise<CheckResult>;
};

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = (description: string) => ({ type: 'STRING', description });
export const ANALYZE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    portrait_box: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax] on a 0-1000 scale' },
    species: S('dog, cat, ...'),
    breed: S('most likely breed or mix'),
    colours: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { region: S('body region'), colour: S('coat colour in plain words') }, required: ['region', 'colour'], propertyOrdering: ['region', 'colour'] },
    },
    eyes: S('iris colour'),
    nose: S('nose leather colour'),
    distinctive: S('unusual shape features that make this pet recognisable, or "none"'),
  },
  required: ['portrait_box', 'species', 'breed', 'colours', 'eyes', 'nose', 'distinctive'],
  propertyOrdering: ['portrait_box', 'species', 'breed', 'colours', 'eyes', 'nose', 'distinctive'],
};
const ANALYZE_PROMPT = `Describe the pet in this photo. Report only what is visible.
- portrait_box: a box around the pet's head including both ears, plus the neck and the top of the chest, as [ymin, xmin, ymax, xmax] on a 0-1000 scale.
- colours: one entry per visible region, in this order where visible: forehead, eyebrow spots, cheeks, muzzle, chin, ear backs, ear insides, neck, chest, body. Give the coat colour in two to four plain words (e.g. "rich red-orange", "cream white").
- eyes, nose: colour only.
- distinctive: shape features that make this individual recognisable (a folded ear, a crooked blaze, one blue eye); "none" if nothing stands out.
One short phrase per field. No fur, whisker, or texture words.`;

export const JUDGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    strands: { type: 'BOOLEAN', description: 'any hair, whisker, bristle, or thin line-like strand on or sticking out of the pet' },
    nose_pearls: { type: 'BOOLEAN', description: 'the nose is built from several separate round pearls' },
    real_fur: { type: 'BOOLEAN', description: 'any patch of the pet shows real fur or skin texture instead of pearls' },
    uneven: { type: 'STRING', enum: ['none', 'few', 'many'], description: 'beads on the pet clearly smaller or larger than the main pearl size' },
    broken: { type: 'STRING', enum: ['none', 'few', 'many'], description: 'pearls on the pet that are cut, squashed, oval, fused, or overlapping' },
    note: S('one short sentence naming the worst defect and where it is'),
  },
  required: ['strands', 'nose_pearls', 'real_fur', 'uneven', 'broken', 'note'],
  propertyOrdering: ['strands', 'nose_pearls', 'real_fur', 'uneven', 'broken', 'note'],
};
const JUDGE_PROMPT = `This image should show a pet recreated as a mosaic of identical round pearls in front of a painted background.
Inspect only the pet, zooming in mentally on the muzzle, cheeks, brows, eye rims, and nose. Answer each field strictly from what you see.`;

/** Luật đạt / không đạt như verdict() của /api/check (phần judge; bỏ pixel gate python). */
export function verdict(judge: Judge): { pass: boolean; why: string[] } {
  const why: string[] = [];
  if (judge.strands) why.push('hair or whisker strands');
  if (!judge.nose_pearls) why.push('nose not made of pearls');
  if (judge.real_fur) why.push('real fur or skin texture');
  if (judge.uneven === 'many') why.push('uneven pearl sizes');
  if (judge.broken === 'many') why.push('many broken or squashed pearls');
  return { pass: !why.length, why };
}

async function geminiAnalyze(ref: Img): Promise<Analysis | null> {
  if (!geminiKey()) return null;
  return geminiJson<Analysis>([imagePart(ref), { text: ANALYZE_PROMPT }], ANALYZE_SCHEMA);
}
async function geminiCheck(img: Img): Promise<CheckResult> {
  if (!geminiKey()) return { pass: true, why: [], judge: null, skipped: 'no GEMINI_API_KEY for the judge' };
  const judge = await geminiJson<Judge>([imagePart(img), { text: JUDGE_PROMPT }], JUDGE_SCHEMA);
  return { ...verdict(judge), judge, skipped: null };
}

const DEMO: Record<string, string> = { 'royal-starry': 'starry-king', 'sunflower-queen': 'sunflower-queen', 'cafe-duke': 'cafe-duke' };
const DEMO_FILES = ['starry-king', 'sunflower-queen', 'cafe-duke'];
/** Ảnh mẫu cho 1 style: map trực tiếp nếu có, style khác chọn ổn định theo tên. */
export function demoFor(style: string | null): string {
  const s = style || '';
  if (DEMO[s]) return DEMO[s];
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DEMO_FILES[h % DEMO_FILES.length];
}

export function providerFor(s: Settings, sleep: Sleep = realSleep): Provider {
  const model = s.ai.model;
  if (s.ai.provider === 'gemini' || s.ai.provider === 'openai') {
    const lane = laneOf(s.ai.provider, model);
    const name = s.ai.provider;
    return {
      name, model,
      analyze: geminiAnalyze,
      async generate({ style, ref, analysis, attempt }) {
        const prompt = withFeatures(buildPrompt(style, lane), featuresBlock(analysis));
        // Lần chạy lại (sau khi judge không đạt) nâng temperature để không ra lại đúng ảnh cũ.
        return name === 'gemini' ? geminiImage(model, prompt, ref, attempt > 1 ? 0.6 : 0) : openaiImage(model, prompt, ref);
      },
      check: geminiCheck,
    };
  }
  const ms = Math.max(0, s.ai.mock_ms);
  return {
    name: 'mock', model,
    async analyze() { await sleep(ms * 0.15); return null; },
    async generate({ style }) {
      await sleep(ms * 0.65);
      const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'demo', `${demoFor(style)}.webp`));
      return { mime: 'image/webp', buf };
    },
    async check() { await sleep(ms * 0.1); return { pass: true, why: [], judge: null, skipped: 'mock provider' }; },
  };
}
