// Đọc/ghi điểm ảnh RGBA cho server. PNG 8-bit: lib/png.js (không cần gì thêm). Còn lại (JPEG của Gemini…) và
// ghi JPEG: tools/pixels.py qua .venv (OpenCV — cùng .venv với tools/gate.py). Không có .venv thì lỗi code
// 'no-decoder' để trình duyệt đang mở ghép thay (xem app.js watchJob).
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { decodePng, encodePng, isPng } from './png.js';

export function pixelIO(py, script) {
  const hasPy = () => fs.existsSync(py);
  const noDecoder = (what) => Object.assign(new Error(`Cần .venv (OpenCV) để ${what} — xem tools/pixels.py`), { code: 'no-decoder' });

  async function read(file) {
    const buf = fs.readFileSync(file);
    if (isPng(buf)) { try { return decodePng(buf); } catch {} }
    if (!hasPy()) throw noDecoder(`đọc ${file.split('/').pop()}`);
    const out = await new Promise((ok, bad) => execFile(py, [script, 'decode', file], { encoding: 'buffer', maxBuffer: 1 << 28, timeout: 60000 },
      (err, so, se) => (err ? bad(new Error(`pixels.py: ${String(se || err.message).slice(0, 200)}`)) : ok(so))));
    const w = out.readUInt32LE(0), h = out.readUInt32LE(4);
    return { w, h, data: new Uint8Array(out.buffer, out.byteOffset + 8, w * h * 4) };
  }

  // base: đường dẫn không có đuôi. Trả về tên file đã ghi (JPEG nếu có .venv, không thì PNG).
  async function write(base, w, h, data) {
    if (!hasPy()) { fs.writeFileSync(`${base}.png`, encodePng(w, h, data)); return `${base}.png`.split('/').pop(); }
    await new Promise((ok, bad) => {
      const p = spawn(py, [script, 'encode', `${base}.jpg`, String(w), String(h)]);
      let se = '';
      p.stderr.on('data', (d) => { se += d; });
      p.on('error', bad);
      p.on('close', (code) => (code ? bad(new Error(`pixels.py encode: ${se.slice(0, 200)}`)) : ok()));
      p.stdin.end(Buffer.from(data.buffer, data.byteOffset, w * h * 4));
    });
    return `${base}.jpg`.split('/').pop();
  }
  return { read, write, hasPy };
}
