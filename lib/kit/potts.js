// KIT-23 gán nhãn MRF / Potts trên đồ thị viên: E(l) = Σ_i U[i·L + l_i] + Σ_(i,j,w) w·[l_i ≠ l_j]
// giải bằng alpha-expansion (Boykov–Veksler–Zabih 2001; mỗi bước = 1 lát cắt nhỏ nhất, Dinic) — Potts là metric nên mỗi bước tối ưu
// chính xác trong lân cận "đổi sang α"; nghiệm cuối trong 2× tối ưu toàn cục. ICM để so sánh.
const BIG = 1e6; // U vô cùng (nhãn cấm) → hữu hạn để lát cắt không tràn

class Flow {
  constructor(n) { this.n = n; this.head = new Int32Array(n).fill(-1); this.to = []; this.cap = []; this.next = []; }
  add(u, v, c, rc = 0) {
    this.to.push(v); this.cap.push(c); this.next.push(this.head[u]); this.head[u] = this.to.length - 1;
    this.to.push(u); this.cap.push(rc); this.next.push(this.head[v]); this.head[v] = this.to.length - 1;
  }
  // Dinic: BFS tầng + DFS đường tăng (vòng lặp, không đệ quy: chuỗi viên dài)
  max(s, t) {
    const { n, head, to, cap, next } = this, lvl = new Int32Array(n), it = new Int32Array(n), q = new Int32Array(n);
    const st = new Int32Array(n), se = new Int32Array(n);
    let flow = 0;
    for (;;) {
      lvl.fill(-1); lvl[s] = 0; let qh = 0, qt = 0; q[qt++] = s;
      while (qh < qt) { const u = q[qh++]; for (let e = head[u]; e >= 0; e = next[e]) if (cap[e] > 1e-12 && lvl[to[e]] < 0) { lvl[to[e]] = lvl[u] + 1; q[qt++] = to[e]; } }
      if (lvl[t] < 0) return flow;
      for (let u = 0; u < n; u++) it[u] = head[u];
      for (;;) {
        // tìm 1 đường s → t trên đồ thị tầng
        let d = 0; st[0] = s;
        while (d >= 0 && st[d] !== t) {
          const u = st[d]; let e = it[u];
          while (e >= 0 && !(cap[e] > 1e-12 && lvl[to[e]] === lvl[u] + 1)) e = next[e];
          it[u] = e;
          if (e < 0) { lvl[u] = -1; d--; if (d >= 0) it[st[d]] = next[it[st[d]]]; continue; }
          se[d] = e; st[++d] = to[e];
        }
        if (d < 0) break;
        let f = Infinity;
        for (let k = 0; k < d; k++) f = Math.min(f, cap[se[k]]);
        for (let k = 0; k < d; k++) { cap[se[k]] -= f; cap[se[k] ^ 1] += f; }
        flow += f;
      }
    }
  }
  // đỉnh còn tới được từ s trong đồ thị dư = phía s của lát cắt
  sourceSide(s) {
    const seen = new Uint8Array(this.n), q = [s]; seen[s] = 1;
    while (q.length) { const u = q.pop(); for (let e = this.head[u]; e >= 0; e = this.next[e]) if (this.cap[e] > 1e-12 && !seen[this.to[e]]) { seen[this.to[e]] = 1; q.push(this.to[e]); } }
    return seen;
  }
}

const fin = (v) => (Number.isFinite(v) ? Math.min(v, BIG) : BIG);

export function pottsEnergy({ L, unary, edges }, labels) {
  let E = 0;
  for (let i = 0; i < labels.length; i++) E += fin(unary[i * L + labels[i]]);
  for (const [i, j, w] of edges) if (labels[i] !== labels[j]) E += w;
  return E;
}

// o = { n, L, unary: Float64Array(n·L), edges: [[i, j, w ≥ 0]], init?: nhãn đầu (mặc định argmin U), maxCycles }
export function pottsExpand(o) {
  const { n, L, unary, edges } = o, maxCycles = o.maxCycles ?? 6;
  const lab = Int32Array.from(o.init || Array.from({ length: n }, (_, i) => { let b = 0; for (let l = 1; l < L; l++) if (unary[i * L + l] < unary[i * L + b]) b = l; return b; }));
  let E = pottsEnergy(o, lab);
  const hist = [E];
  let cycles = 0;
  for (; cycles < maxCycles; cycles++) {
    let improved = false;
    for (let a = 0; a < L; a++) {
      const S = n, T = n + 1, F = new Flow(n + 2), sw = new Float64Array(n), kp = new Float64Array(n);
      // tuyến tính: chi phí đổi (x=1) − giữ (x=0)
      for (let i = 0; i < n; i++) { const c = fin(unary[i * L + a]) - fin(unary[i * L + lab[i]]); if (c > 0) sw[i] += c; else kp[i] -= c; }
      for (const [i, j, w] of edges) {
        if (!w) continue;
        const E00 = lab[i] !== lab[j] ? w : 0, E01 = lab[i] !== a ? w : 0, E10 = a !== lab[j] ? w : 0; // E11 = 0
        const ci = E10 - E00, cj = -E10, P = E01 + E10 - E00;
        if (ci > 0) sw[i] += ci; else kp[i] -= ci;
        if (cj > 0) sw[j] += cj; else kp[j] -= cj;
        if (P > 1e-12) F.add(i, j, P); // (1 − x_i)·x_j: i giữ, j đổi
      }
      for (let i = 0; i < n; i++) { if (sw[i] > 1e-12) F.add(S, i, sw[i]); if (kp[i] > 1e-12) F.add(i, T, kp[i]); }
      F.max(S, T);
      const keep = F.sourceSide(S), nl = Int32Array.from(lab);
      for (let i = 0; i < n; i++) if (!keep[i]) nl[i] = a;
      const E2 = pottsEnergy(o, nl);
      if (E2 < E - 1e-9) { lab.set(nl); E = E2; improved = true; }
    }
    hist.push(E);
    if (!improved) break;
  }
  return { labels: lab, energy: E, cycles: cycles + 1, history: hist };
}

// ICM: mỗi nút lấy nhãn tốt nhất khi láng giềng cố định, lặp tới khi đứng (so sánh / kiểm thử)
export function pottsICM(o) {
  const { n, L, unary, edges } = o, adj = Array.from({ length: n }, () => []);
  for (const [i, j, w] of edges) { adj[i].push([j, w]); adj[j].push([i, w]); }
  const lab = Int32Array.from(o.init || Array.from({ length: n }, (_, i) => { let b = 0; for (let l = 1; l < L; l++) if (unary[i * L + l] < unary[i * L + b]) b = l; return b; }));
  for (let it = 0; it < (o.maxIter ?? 20); it++) {
    let ch = 0;
    for (let i = 0; i < n; i++) {
      let best = lab[i], bc = Infinity;
      for (let l = 0; l < L; l++) { let c = fin(unary[i * L + l]); for (const [j, w] of adj[i]) if (lab[j] !== l) c += w; if (c < bc - 1e-12) { bc = c; best = l; } }
      if (best !== lab[i]) { lab[i] = best; ch++; }
    }
    if (!ch) break;
  }
  return { labels: lab, energy: pottsEnergy(o, lab) };
}
