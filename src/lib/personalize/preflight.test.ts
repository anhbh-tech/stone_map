import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings';
import { normalizeUpload } from './images';
import { evaluate, mockDetect, runPreflight } from './preflight';

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name));
const mock = { name: 'mock' as const, detect: mockDetect };
async function check(name: string) {
  const n = await normalizeUpload(fixture(name));
  return runPreflight(n.buf, { width: n.width, height: n.height }, DEFAULTS, mock);
}
const codes = (p: { issues: { code: string }[] }) => p.issues.map((i) => i.code);

describe('preflight (mock provider) on the fixtures', () => {
  it('blocks not-a-pet.jpg: no pet found', async () => {
    const p = await check('not-a-pet.jpg');
    expect(p.ok).toBe(false);
    expect(codes(p)).toContain('no_pet');
    expect(p.pet.found).toBe(false);
  });
  it('blocks pet-blurry.jpg: blurry, but a pet is there', async () => {
    const p = await check('pet-blurry.jpg');
    expect(p.ok).toBe(false);
    expect(codes(p)).toEqual(['blurry']);
    expect(p.sharpness).toBeLessThan(DEFAULTS.preflight.min_sharpness);
  });
  it('blocks pet-too-small.jpg: short side under min_side_px', async () => {
    const p = await check('pet-too-small.jpg');
    expect(p.ok).toBe(false);
    expect(codes(p)).toContain('too_small');
    expect(Math.min(p.width, p.height)).toBeLessThan(DEFAULTS.preflight.min_side_px);
  });
  it('passes pet-ok.jpg', async () => {
    const p = await check('pet-ok.jpg');
    expect(p).toMatchObject({ ok: true, issues: [], width: 1600, height: 1067 });
    expect(p.sharpness).toBeGreaterThanOrEqual(DEFAULTS.preflight.min_sharpness);
    expect(p.pet.found).toBe(true);
    expect(p.pet.confidence).toBeGreaterThanOrEqual(DEFAULTS.preflight.min_pet_confidence);
    expect(p.pet.box).toHaveLength(4);
  });
});

describe('normalizeUpload', () => {
  it('strips EXIF / GPS metadata', async () => {
    const sharp = (await import('sharp')).default;
    expect((await sharp(fixture('pet-ok.jpg')).metadata()).exif).toBeDefined();
    const n = await normalizeUpload(fixture('pet-ok.jpg'));
    const m = await sharp(n.buf).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.format).toBe('jpeg');
  });
  it('applies EXIF orientation before measuring size', async () => {
    const sharp = (await import('sharp')).default;
    const rotated = await sharp(fixture('pet-ok.jpg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const n = await normalizeUpload(rotated);
    expect([n.width, n.height]).toEqual([1067, 1600]);
  });
});

describe('evaluate rules', () => {
  const base = { width: 1200, height: 1200, sharpness: 200, pet: { found: true, species: 'dog', confidence: 0.9, box: null, count: 1, face_visible: true } };
  it('low pet confidence counts as no pet', () => {
    expect(codes(evaluate({ ...base, pet: { ...base.pet, confidence: 0.4 } }, DEFAULTS.preflight))).toEqual(['no_pet']);
  });
  it('flags multiple pets and hidden faces', () => {
    expect(codes(evaluate({ ...base, pet: { ...base.pet, count: 2 } }, DEFAULTS.preflight))).toEqual(['multiple_pets']);
    expect(codes(evaluate({ ...base, pet: { ...base.pet, face_visible: false } }, DEFAULTS.preflight))).toEqual(['face_hidden']);
  });
});
