// PNG tối giản, không dependency: đủ cho ảnh 8-bit không interlace mà các provider trả về và ảnh giả của mock.
// Ảnh JPEG thì lib/pixels.js chuyển qua .venv (OpenCV).
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const isPng = (buf) => buf.length > 8 && buf.subarray(0, 8).equals(SIG);

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// rgba: Uint8Array w*h*4. text: {key: value} → chunk tEXt (mock dùng để ghi "đáp án" cho judge giả).
// compact: lọc Paeth + deflate 9 (ảnh chụp / tranh nhỏ hơn nhiều); rgb: bỏ kênh alpha (ảnh đục).
export function encodePng(w, h, rgba, text = {}, { compact = false, rgb = false } = {}) {
  const ch = rgb ? 3 : 4, stride = w * ch, raw = Buffer.alloc((stride + 1) * h);
  const row = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    if (rgb) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4; row[x * 3] = rgba[s]; row[x * 3 + 1] = rgba[s + 1]; row[x * 3 + 2] = rgba[s + 2]; }
    else Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, stride).copy(row);
    const o = y * (stride + 1);
    if (!compact) row.copy(raw, o + 1);
    else {
      raw[o] = 4;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? row[x - ch] : 0, b = y ? prev[x] : 0, c = x >= ch && y ? prev[x - ch] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        raw[o + 1 + x] = (row[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      row.copy(prev);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = rgb ? 2 : 6;
  return Buffer.concat([
    SIG, chunk('IHDR', ihdr),
    ...Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1'))),
    chunk('IDAT', zlib.deflateSync(raw, compact ? { level: 9 } : {})), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunks(buf) {
  if (!isPng(buf)) throw new Error('không phải PNG');
  const out = [];
  for (let o = 8; o + 8 <= buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    out.push({ type, data: buf.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

export function pngText(buf) {
  const t = {};
  try {
    for (const c of chunks(buf)) if (c.type === 'tEXt') { const i = c.data.indexOf(0); t[c.data.toString('latin1', 0, i)] = c.data.toString('latin1', i + 1); }
  } catch {}
  return t;
}

// → { w, h, data: Uint8Array RGBA }. Hỗ trợ 8-bit, màu xám / RGB / bảng màu / xám+alpha / RGBA, không interlace.
export function decodePng(buf) {
  const cs = chunks(buf), hd = cs.find((c) => c.type === 'IHDR')?.data;
  if (!hd) throw new Error('PNG thiếu IHDR');
  const w = hd.readUInt32BE(0), h = hd.readUInt32BE(4), depth = hd[8], type = hd[9], interlace = hd[12];
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`PNG chưa hỗ trợ (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const pal = cs.find((c) => c.type === 'PLTE')?.data, trns = cs.find((c) => c.type === 'tRNS')?.data;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, d = i * 4;
    if (type === 6) { data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = px[s + 3]; }
    else if (type === 2) { data[d] = px[s]; data[d + 1] = px[s + 1]; data[d + 2] = px[s + 2]; data[d + 3] = 255; }
    else if (type === 3) { const k = px[s]; data[d] = pal[k * 3]; data[d + 1] = pal[k * 3 + 1]; data[d + 2] = pal[k * 3 + 2]; data[d + 3] = trns && k < trns.length ? trns[k] : 255; }
    else { data[d] = data[d + 1] = data[d + 2] = px[s]; data[d + 3] = type === 4 ? px[s + 1] : 255; }
  }
  return { w, h, data };
}
