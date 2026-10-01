// Preflight ảnh upload (#1): chặn trước khi tốn tiền AI và trước khi AI "bịa" ra một con thú từ ảnh không có thú.
// Ba phép kiểm: cạnh ngắn ≥ min_side_px, độ nét (variance of Laplacian) ≥ min_sharpness, có đúng 1 thú cưng (confidence ≥ min_pet_confidence).
import type { Preflight, PreflightIssue, Settings } from '../types';
import { geminiJson, geminiKey, imagePart } from './gemini';
import { sharpness, texture, type Texture } from './images';

export type PetDetection = Preflight['pet'] & { count: number; face_visible: boolean };
export type Detector = (buf: Buffer) => Promise<PetDetection>;

/** Heuristic cho provider mock: ảnh có chủ thể có entropy tông xám và mật độ cạnh cao ở 64 px (không phụ thuộc độ nét). */
export function mockDetectFromTexture(t: Texture): PetDetection {
  const confidence = Math.round(Math.min(1, t.entropy / 4) * Math.min(1, t.edgeDensity / 0.2) * 0.95 * 100) / 100;
  const found = confidence >= 0.5;
  return { found, species: null, confidence, box: found ? t.box : null, count: found ? 1 : 0, face_visible: found };
}
export const mockDetect: Detector = async (buf) => mockDetectFromTexture(await texture(buf));

const PET_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pet_count: { type: 'INTEGER', description: 'number of real animals visible in the photo (0 if none; drawings, toys and statues do not count)' },
    species: { type: 'STRING', description: 'species of the main animal (dog, cat, rabbit, ...) or "none"' },
    confidence: { type: 'NUMBER', description: 'confidence from 0 to 1 that the photo shows a real pet' },
    face_visible: { type: 'BOOLEAN', description: "the main animal's face (both eyes and nose) is clearly visible" },
    box: { type: 'ARRAY', items: { type: 'INTEGER' }, description: "box around the main animal's head and chest as [ymin, xmin, ymax, xmax] on a 0-1000 scale" },
  },
  required: ['pet_count', 'species', 'confidence', 'face_visible', 'box'],
  propertyOrdering: ['pet_count', 'species', 'confidence', 'face_visible', 'box'],
};
const PET_PROMPT = `Is there a real pet in this photo? Report only what is visible.
- pet_count: how many real animals are visible.
- species: the main animal's species, or "none".
- confidence: 0 to 1 that this is a photo of a real pet.
- face_visible: true if the main animal's face, with both eyes and nose, is clearly visible.
- box: the main animal's head and chest as [ymin, xmin, ymax, xmax] on a 0-1000 scale; [0,0,0,0] if none.`;

type PetAnswer = { pet_count: number; species: string; confidence: number; face_visible: boolean; box: number[] };

/** Gemini Flash structured output (như /api/analyze của pearl_compare). */
export const geminiDetect: Detector = async (buf) => {
  const a = await geminiJson<PetAnswer>([imagePart({ mime: 'image/jpeg', buf }), { text: PET_PROMPT }], PET_SCHEMA);
  const count = Math.max(0, Math.round(Number(a.pet_count) || 0));
  const confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0));
  const b = Array.isArray(a.box) && a.box.length === 4 && a.box.some((v) => v > 0) ? a.box.map((v) => Math.max(0, Math.min(1000, v)) / 1000) : null;
  const species = a.species && a.species.toLowerCase() !== 'none' ? a.species.toLowerCase() : null;
  return { found: count > 0, species, confidence, box: b ? [b[1], b[0], b[3], b[2]] : null, count, face_visible: !!a.face_visible };
};

/** Chọn detector: mock → heuristic; provider thật + có GEMINI_API_KEY → Gemini Flash; thiếu key → heuristic. */
export function detectorFor(s: Settings): { name: 'mock' | 'gemini'; detect: Detector } {
  if (s.ai.provider !== 'mock' && geminiKey()) return { name: 'gemini', detect: geminiDetect };
  return { name: 'mock', detect: mockDetect };
}

/** Luật đạt / không đạt, thuần tuý (test được). Mọi issue đều chặn AI; khách được gợi ý Designer finish. */
export function evaluate(m: { width: number; height: number; sharpness: number; pet: PetDetection }, cfg: Settings['preflight']): Preflight {
  const issues: PreflightIssue[] = [];
  const short = Math.min(m.width, m.height);
  if (short < cfg.min_side_px) {
    issues.push({ code: 'too_small', message: `This photo is ${m.width}×${m.height} px. We need at least ${cfg.min_side_px} px on the short side for a sharp print, so try the original photo rather than a screenshot or thumbnail.` });
  }
  if (m.sharpness < cfg.min_sharpness) {
    issues.push({ code: 'blurry', message: 'This photo looks blurry. Choose a sharper photo taken in good light, with your pet in focus.' });
  }
  const petOk = m.pet.found && m.pet.confidence >= cfg.min_pet_confidence;
  if (!petOk) {
    issues.push({ code: 'no_pet', message: "We couldn't find a pet in this photo. Upload a photo where your pet is clearly visible." });
  } else if (m.pet.count > 1) {
    issues.push({ code: 'multiple_pets', message: 'We found more than one animal. AI portraits work with one pet, so pick a photo of just one, or choose Designer finish.' });
  } else if (!m.pet.face_visible) {
    issues.push({ code: 'face_hidden', message: "Your pet's face isn't clearly visible. Pick a photo where both eyes and the nose can be seen." });
  }
  return {
    ok: issues.length === 0,
    width: m.width,
    height: m.height,
    sharpness: m.sharpness,
    pet: { found: petOk, species: m.pet.species, confidence: m.pet.confidence, box: m.pet.box },
    issues,
  };
}

/** Preflight ảnh đã chuẩn hoá. Detector thật lỗi mạng → rơi về heuristic thay vì làm hỏng upload. */
export async function runPreflight(buf: Buffer, size: { width: number; height: number }, s: Settings, detector = detectorFor(s)): Promise<Preflight> {
  const [sharp, pet] = await Promise.all([
    sharpness(buf),
    detector.detect(buf).catch((e: unknown) => {
      console.warn('[preflight] detector failed, using heuristic:', e instanceof Error ? e.message : e);
      return mockDetect(buf);
    }),
  ]);
  return evaluate({ ...size, sharpness: sharp, pet }, s.preflight);
}
