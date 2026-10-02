// QC STONEMAP: registry plugin. Mỗi file *.js khác index.js trong thư mục này = 1 kiểm định:
//   export default { id, level: 'error'|'warn', title, run(design, ctx) → findings[] }
//   finding = { level: 'error'|'warn'|'info'|'pass', msg, data?, ids? }   (ids = id viên liên quan, cắt ≤ 50)
// Thêm kiểm định mới = thêm 1 file. ctx = { cat, mask?, mockup?, preview?, ... } (kiểm định thiếu input → 'info' bỏ qua).
//   runQc(design, ctx) → { status, checks: [{ id, title, status, findings }] }, status = mức nặng nhất ('pass' nếu không có gì).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCatalog } from '../catalog.js';

export const RANK = { pass: 0, info: 1, warn: 2, error: 3 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const registry = new Map();

export function register(check) {
  if (!check?.id || typeof check.run !== 'function' || !RANK[check.level]) throw new Error(`plugin QC sai dạng: ${check?.id}`);
  registry.set(check.id, check);
  return check;
}

export const unregister = (id) => registry.delete(id);

export async function loadChecks(dir = DIR) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js').sort()) {
    const m = await import(pathToFileURL(path.join(dir, f)).href);
    register(m.default);
  }
  return [...registry.values()];
}

export const worst = (levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'pass');

export async function runQc(design, ctx = {}, { only = null } = {}) {
  if (!registry.size) await loadChecks();
  const c = { cat: loadCatalog(), ...ctx };
  const checks = [];
  for (const chk of registry.values()) {
    if (only && !only.includes(chk.id)) continue;
    let findings;
    try { findings = chk.run(design, c) || []; } catch (e) { findings = [{ level: 'error', msg: `kiểm định lỗi: ${e.message}` }]; }
    for (const f of findings) if (f.ids?.length > 50) { f.nIds = f.ids.length; f.ids = f.ids.slice(0, 50); }
    checks.push({ id: chk.id, title: chk.title, status: worst(findings.map((f) => f.level)), findings });
  }
  return { status: worst(checks.map((k) => k.status)), checks };
}
