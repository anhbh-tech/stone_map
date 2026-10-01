// Gemini Flash structured output — chỉ cho preflight (có thú cưng trong ảnh không). Ảnh pearl, cutout, judge và mọi
// prompt sinh ảnh nằm ở pearl_compare (./engine.ts); không có bản sao prompt nào ở đây. Key đọc từ env, không log.
const TIMEOUT_MS = 60_000;

export const geminiKey = () => process.env.GEMINI_API_KEY || '';
export const analyzeModel = () => process.env.ANALYZE_MODEL || 'gemini-flash-latest';

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

export const imagePart = (img: { mime: string; buf: Buffer }): Part => ({ inlineData: { mimeType: img.mime, data: img.buf.toString('base64') } });

/** Temperature 0, responseSchema = schema. */
export async function geminiJson<T>(parts: Part[], schema: object): Promise<T> {
  const key = geminiKey();
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${analyzeModel()}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
  const r = JSON.parse(body) as GeminiResponse;
  const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try { return JSON.parse(text) as T; } catch { throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`); }
}
