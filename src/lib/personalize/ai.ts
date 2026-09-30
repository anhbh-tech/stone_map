// Gọi API AI thật (port từ pearl_compare/server.js). Key đọc từ env, không bao giờ log hay trả về client.
export type Img = { mime: string; buf: Buffer };

const TIMEOUT_MS = 5 * 60 * 1000;

export class AiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

async function j(url: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const b = body as { error?: { message?: string }; message?: string } | string;
    const msg = typeof b === 'string' ? b : b?.error?.message || b?.message || JSON.stringify(b);
    throw new AiError(`HTTP ${res.status}: ${msg}`.slice(0, 600), res.status);
  }
  return body;
}

async function download(url: string): Promise<Img> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new AiError(`Image download failed: HTTP ${res.status}`, res.status);
  return { mime: res.headers.get('content-type') || 'image/png', buf: Buffer.from(await res.arrayBuffer()) };
}

export const geminiKey = () => process.env.GEMINI_API_KEY || '';
export const openaiKey = () => process.env.OPENAI_API_KEY || '';
export const analyzeModel = () => process.env.ANALYZE_MODEL || 'gemini-flash-latest';

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type GeminiResponse = { candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[]; promptFeedback?: unknown };

export const imagePart = (img: Img): Part => ({ inlineData: { mimeType: img.mime, data: img.buf.toString('base64') } });

/** Gemini Flash structured output, temperature 0 (giống geminiJson trong pearl_compare). */
export async function geminiJson<T>(parts: Part[], schema: object): Promise<T> {
  const key = geminiKey();
  if (!key) throw new AiError('GEMINI_API_KEY is not set');
  const r = (await j(`https://generativelanguage.googleapis.com/v1beta/models/${analyzeModel()}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
    }),
  })) as GeminiResponse;
  const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try { return JSON.parse(text) as T; } catch { throw new AiError(`Model did not return JSON: ${text.slice(0, 200)}`); }
}

/** Gemini image (generateContent IMAGE+TEXT, ảnh ref đi trước text), thử lại tối đa 2 lần khi không có ảnh. */
export async function geminiImage(model: string, prompt: string, ref: Img | null, temperature = 0): Promise<Img> {
  const key = geminiKey();
  if (!key) throw new AiError('GEMINI_API_KEY is not set');
  const parts: Part[] = [];
  if (ref) parts.push(imagePart(ref));
  parts.push({ text: prompt });
  const imageConfig: Record<string, string> = { aspectRatio: '1:1' };
  if (/^gemini-3/.test(model)) imageConfig.imageSize = '2K';
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature, imageConfig },
  });
  let last: GeminiResponse | null = null;
  const texts: string[] = [];
  for (let attempt = 0; attempt <= 2; attempt++) {
    last = (await j(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body,
    })) as GeminiResponse;
    for (const p of last.candidates?.[0]?.content?.parts || []) {
      if (p.inlineData?.data) return { mime: p.inlineData.mimeType, buf: Buffer.from(p.inlineData.data, 'base64') };
      if (p.text) texts.push(p.text);
    }
  }
  throw new AiError(`No image returned. ${texts.join(' ') || last?.candidates?.[0]?.finishReason || JSON.stringify(last?.promptFeedback || {})}`.slice(0, 600));
}

/** OpenAI images: có ảnh ref → /images/edits, không → /images/generations. */
export async function openaiImage(model: string, prompt: string, ref: Img | null): Promise<Img> {
  const key = openaiKey();
  if (!key) throw new AiError('OPENAI_API_KEY is not set');
  const auth = { authorization: `Bearer ${key}` };
  const isDalle = /^dall-e/.test(model);
  let r: { data?: { b64_json?: string; url?: string }[] };
  if (ref && model !== 'dall-e-3') {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    if (isDalle) fd.append('response_format', 'b64_json');
    fd.append('image', new Blob([new Uint8Array(ref.buf)], { type: ref.mime }), `ref.${ref.mime.split('/')[1] || 'png'}`);
    r = (await j('https://api.openai.com/v1/images/edits', { method: 'POST', headers: auth, body: fd })) as typeof r;
  } else {
    const body: Record<string, unknown> = { model, prompt, n: 1 };
    if (isDalle) body.response_format = 'b64_json';
    r = (await j('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })) as typeof r;
  }
  const d = r.data?.[0];
  if (d?.b64_json) return { mime: 'image/png', buf: Buffer.from(d.b64_json, 'base64') };
  if (d?.url) return download(d.url);
  throw new AiError('No image returned');
}
