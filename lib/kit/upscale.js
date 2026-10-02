// KIT-17: phóng ảnh ×4 cục bộ, không gọi API. Real-ESRGAN (realesrgan-ncnn-vulkan + model realesrgan-x4plus, chạy GPU qua Vulkan/MoltenVK)
// qua child_process; thiếu binary/model hoặc lỗi → Lanczos-3 tách được bằng JS. Binary + model KHÔNG commit:
//   REALESRGAN_BIN=<đường dẫn binary> | tools/bin/realesrgan-ncnn-vulkan | ~/.cache/realesrgan/realesrgan-ncnn-vulkan
//   model ở <thư mục binary>/models/<tên>.param|.bin (bản macOS: github.com/xinntao/Real-ESRGAN/releases v0.2.5.0, 20220424-macos.zip).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng } from '../png.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = 'realesrgan-ncnn-vulkan';

// → { bin, models } hoặc null
export function findRealesrgan(model = 'realesrgan-x4plus') {
  const cands = [process.env.REALESRGAN_BIN, path.join(ROOT, 'tools', 'bin', BIN), path.join(os.homedir(), '.cache', 'realesrgan', BIN)].filter(Boolean);
  for (const bin of cands) {
    const models = path.join(path.dirname(bin), 'models');
    if (fs.existsSync(bin) && fs.existsSync(path.join(models, `${model}.param`)) && fs.existsSync(path.join(models, `${model}.bin`))) return { bin, models };
  }
  return null;
}

// Lanczos-3 tách được, ảnh RGBA → RGBA cỡ (w·s, h·s). Kênh alpha cũng nội suy.
export function lanczos(img, s) {
  const a = 3, W2 = Math.round(img.w * s), H2 = Math.round(img.h * s);
  const L = (x) => (x === 0 ? 1 : Math.abs(x) >= a ? 0 : (a * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / a)) / (Math.PI * Math.PI * x * x));
  const taps = (n, n2) => Array.from({ length: n2 }, (_, i) => {
    const c = (i + 0.5) / s - 0.5, i0 = Math.floor(c) - a + 1, w = [];
    let sum = 0;
    for (let t = 0; t < 2 * a; t++) { const v = L(c - (i0 + t)); w.push(v); sum += v; }
    return { i0, w: w.map((v) => v / sum), n };
  });
  const tx = taps(img.w, W2), ty = taps(img.h, H2), mid = new Float32Array(W2 * img.h * 4), out = new Uint8Array(W2 * H2 * 4);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < W2; x++) {
    const { i0, w } = tx[x];
    for (let c = 0; c < 4; c++) { let v = 0; for (let t = 0; t < w.length; t++) v += w[t] * img.data[(y * img.w + Math.min(img.w - 1, Math.max(0, i0 + t))) * 4 + c]; mid[(y * W2 + x) * 4 + c] = v; }
  }
  for (let y = 0; y < H2; y++) { const { i0, w } = ty[y];
    for (let x = 0; x < W2; x++) for (let c = 0; c < 4; c++) {
      let v = 0; for (let t = 0; t < w.length; t++) v += w[t] * mid[(Math.min(img.h - 1, Math.max(0, i0 + t)) * W2 + x) * 4 + c];
      out[(y * W2 + x) * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    } }
  return { w: W2, h: H2, data: out };
}

// Thu nhỏ theo trung bình ô (hệ số nguyên) — mô phỏng ảnh đầu vào độ phân giải thấp.
export function boxDown(img, f) {
  const W = Math.floor(img.w / f), H = Math.floor(img.h / f), out = new Uint8Array(W * H * 4), n = f * f;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) s += img.data[((y * f + v) * img.w + x * f + u) * 4 + c];
    out[(y * W + x) * 4 + c] = Math.round(s / n);
  }
  return { w: W, h: H, data: out };
}

// img RGBA → { img (×4), method: 'realesrgan' | 'lanczos', ms, error? }. o: { model, force: 'lanczos', timeoutMs }
export async function upscale4(img, o = {}) {
  const t0 = Date.now(), model = o.model || 'realesrgan-x4plus', re = o.force === 'lanczos' ? null : findRealesrgan(model);
  if (re) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-up-')), src = path.join(dir, 'in.png'), dst = path.join(dir, 'out.png');
    try {
      fs.writeFileSync(src, encodePng(img.w, img.h, img.data));
      await new Promise((res, rej) => execFile(re.bin, ['-i', src, '-o', dst, '-n', model, '-m', re.models, '-s', '4', '-f', 'png'], { timeout: o.timeoutMs ?? 600000, maxBuffer: 1 << 24 },
        (err) => (err ? rej(err) : res())));
      const out = decodePng(fs.readFileSync(dst));
      if (out.w !== img.w * 4 || out.h !== img.h * 4) throw new Error(`cỡ ra ${out.w}×${out.h}`);
      // giữ alpha gốc (ESRGAN xử lý RGB; alpha nội suy Lanczos)
      if (img.data.some((v, j) => j % 4 === 3 && v < 255)) { const al = lanczos(img, 4); for (let j = 3; j < out.data.length; j += 4) out.data[j] = al.data[j]; }
      return { img: out, method: 'realesrgan', ms: Date.now() - t0 };
    } catch (e) {
      return { img: lanczos(img, 4), method: 'lanczos', ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  return { img: lanczos(img, 4), method: 'lanczos', ms: Date.now() - t0 };
}
