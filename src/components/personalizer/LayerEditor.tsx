'use client';
// Editor theo lớp (v2, pearl_compare docs/OUTPUT.md): vẽ đúng thứ tự của final server — base → nền canvas (cắt theo clip)
// → pet (transform, cắt theo clip) → overlay — rồi khung chọn, 4 núm góc (đổi cỡ) và núm xoay lên trên cùng.
// Kéo thân pet = di chuyển, kéo góc = đổi cỡ, kéo núm tròn = xoay, 2 ngón = phóng + xoay, cuộn chuột = phóng.
// Nút xoay / phóng / dịch (giữ nút = lặp) và phím (mũi tên, + -, [ ]) thay cho kéo (WCAG 2.5.7).
// Replace photo = chọn ảnh khác, Cancel = giữ ảnh hiện tại, OK (đỏ) = server render final mới với transform này.
import Image from 'next/image';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { PcDesign, PetTransform, Pt } from './api';
import { canvasBgTransform, corners, dragRotate, dragScale, hitTest, normTransform, rotateHandle, type Hit } from './layers';
import { AlertIcon, ArrowIcon, LoaderIcon, RotateCcwIcon, RotateCwIcon } from '../pdp/icons';
import { Icon } from '../shell/Icon';

type Props = {
  open: boolean;
  layered: PcDesign;
  /** Lưu (render) transform mới; lỗi → ném ra để editor hiện lỗi và giữ nguyên. */
  onSave: (t: PetTransform) => Promise<void>;
  onCancel: () => void;
  onReplace: () => void;
};

type Imgs = { base: HTMLImageElement; overlay: HTMLImageElement; pet: HTMLImageElement; bg: HTMLImageElement | null };

const load = (src: string) => new Promise<HTMLImageElement>((ok, bad) => {
  const im = new window.Image();
  im.onload = () => ok(im);
  im.onerror = () => bad(new Error(src));
  im.src = src;
});

const ROTATE_STEP = 3, ZOOM_STEP = 1.04, MOVE_STEP = 0.01; // MOVE_STEP = phần bề ngang template mỗi lần bấm
const HANDLE = 7, ROT_D = 28; // bán kính núm / độ dài cần xoay, px màn hình
const CURSOR: Record<Exclude<Hit, null> | 'none', string> = { rotate: 'grab', scale: 'nwse-resize', move: 'move', none: 'default' };
const tool = 'inline-flex size-11 items-center justify-center rounded-md border border-border bg-card text-card-foreground transition-colors duration-150 hover:bg-muted';
const pill = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors duration-150 sm:px-5';

// Icon Lucide (zoom-in / zoom-out / image-up / move) — chỉ editor dùng, nét 1.75 như bộ pdp/icons.
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ZoomInIcon = () => svg(<><circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="11" x2="11" y1="8" y2="14" /><line x1="8" x2="14" y1="11" y2="11" /></>);
const ZoomOutIcon = () => svg(<><circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="8" x2="14" y1="11" y2="11" /></>);
const ImageUpIcon = () => svg(<><path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21" /><path d="m14 19.5 3-3 3 3" /><path d="M17 22v-5.5" /><circle cx="9" cy="9" r="2" /></>);
const MoveIcon = () => svg(<><path d="M12 2v20" /><path d="m15 19-3 3-3-3" /><path d="m19 9 3 3-3 3" /><path d="M2 12h20" /><path d="m5 9-3 3 3 3" /><path d="m9 5 3-3 3 3" /></>);

/** Nút dụng cụ: bấm = 1 bước, giữ = lặp. Bàn phím / trình đọc màn hình đi qua onClick (không lặp đôi với pointer). */
function ToolButton({ label, onStep, children }: { label: string; onStep: () => void; children: ReactNode }) {
  const rep = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viaPointer = useRef(false);
  const fn = useRef(onStep);
  useEffect(() => { fn.current = onStep; });
  const stop = () => { if (rep.current) { clearTimeout(rep.current); clearInterval(rep.current); rep.current = null; } };
  useEffect(() => stop, []);
  return (
    <button
      type="button" aria-label={label} title={label} className={tool}
      onPointerDown={(e) => {
        if (e.button) return;
        viaPointer.current = true;
        fn.current();
        rep.current = setTimeout(() => { rep.current = setInterval(() => fn.current(), 60); }, 350);
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onClick={() => { if (viaPointer.current) viaPointer.current = false; else fn.current(); }}
    >{children}</button>
  );
}

function Stage({ layered, imgs, t, setT, disabled }: { layered: PcDesign; imgs: Imgs; t: PetTransform; setT: (t: PetTransform) => void; disabled: boolean }) {
  const { template } = layered;
  const tw = template.size.w, th = template.size.h, quad = template.quad, clip = template.clip?.length ? template.clip : quad;
  const pw = imgs.pet.naturalWidth || layered.cutout.w, ph = imgs.pet.naturalHeight || layered.cutout.h;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [css, setCss] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ mode: Exclude<Hit, null>; p0: Pt; t0: PetTransform } | null>(null);
  const touches = useRef(new Map<number, Pt>());
  const pinch = useRef<{ d0: number; a0: number; t0: PetTransform } | null>(null);
  const [cursor, setCursor] = useState('default');

  // Cỡ hiển thị: vừa bề ngang khung và chiều cao màn hình còn lại (header + dụng cụ + chân dialog).
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const dialog = el.closest('dialog');
      const chrome = dialog ? dialog.scrollHeight - el.offsetHeight : 240;
      const maxW = Math.max(160, el.clientWidth);
      const maxH = Math.max(160, window.innerHeight - 16 - chrome);
      const w = Math.min(maxW, (maxH * tw) / th);
      setCss((c) => (c && Math.abs(c.w - w) < 0.5 ? c : { w, h: (w * th) / tw }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [tw, th]);

  const disp = css ? css.w / tw : 1; // px màn hình / px template

  useLayoutEffect(() => {
    const cv = canvas.current;
    if (!cv || !css) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(Math.min(tw, css.w * dpr)), H = Math.round((W * th) / tw);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const k = W / tw;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgs.base, 0, 0, tw, th);
    ctx.save();
    ctx.beginPath(); clip.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
    if (imgs.bg) {
      const bw = imgs.bg.naturalWidth, bh = imgs.bg.naturalHeight, b = canvasBgTransform(clip, bw, bh);
      ctx.drawImage(imgs.bg, b.x - (bw * b.scale) / 2, b.y - (bh * b.scale) / 2, bw * b.scale, bh * b.scale);
    }
    ctx.translate(t.x, t.y); ctx.rotate((t.rotate * Math.PI) / 180); ctx.scale(t.scale, t.scale);
    ctx.drawImage(imgs.pet, -pw / 2, -ph / 2, pw, ph);
    ctx.restore();
    ctx.drawImage(imgs.overlay, 0, 0, tw, th);
    // Khung chọn + núm vẽ trên ảnh bất kỳ → cặp trắng / đen cố định (không theo theme) để luôn thấy rõ.
    const c = corners(t, pw, ph), r = HANDLE / disp, { mid, at } = rotateHandle(t, pw, ph, ROT_D / disp);
    const path = () => { ctx.beginPath(); c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3 / disp; path(); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / disp; ctx.setLineDash([6 / disp, 4 / disp]); path(); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(...mid); ctx.lineTo(...at); ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1.5 / disp;
    for (const [x, y] of c) { ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.strokeRect(x - r, y - r, 2 * r, 2 * r); }
    ctx.beginPath(); ctx.arc(at[0], at[1], r * 1.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }, [css, t, imgs, clip, tw, th, pw, ph, disp]);

  const pos = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * tw) / r.width, ((e.clientY - r.top) * th) / r.height];
  };
  // Ngón tay to hơn con trỏ: vùng bắt núm ≥ 22 px màn hình (đường kính 44).
  const hit = (p: Pt, coarse: boolean) => hitTest(t, pw, ph, p, (coarse ? 22 : HANDLE * 1.8) / disp, ROT_D / disp);
  const set = (n: PetTransform) => setT(normTransform(n, quad));
  const two = () => { const [a, b] = [...touches.current.values()]; return { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, a: Math.atan2(b[1] - a[1], b[0] - a[0]) }; };

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (disabled || e.button) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer đã kết thúc */ }
    const p = pos(e);
    touches.current.set(e.pointerId, p);
    if (touches.current.size === 2) {
      const { d, a } = two();
      drag.current = null;
      pinch.current = { d0: d, a0: a, t0: t };
      return;
    }
    // Bấm ngoài pet (trong ảnh) vẫn kéo pet: dễ bắt hơn trên điện thoại.
    drag.current = { mode: hit(p, e.pointerType !== 'mouse') || 'move', p0: p, t0: t };
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const p = pos(e);
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, p);
    const pz = pinch.current;
    if (pz && touches.current.size === 2) {
      const { d, a } = two();
      return set({ ...pz.t0, scale: pz.t0.scale * (d / pz.d0), rotate: pz.t0.rotate + ((a - pz.a0) * 180) / Math.PI });
    }
    const dr = drag.current;
    if (!dr) { if (e.pointerType === 'mouse') setCursor(CURSOR[hit(p, false) ?? 'none']); return; }
    const { mode, p0, t0 } = dr;
    set(mode === 'move' ? { ...t0, x: t0.x + p[0] - p0[0], y: t0.y + p[1] - p0[1] } : mode === 'scale' ? dragScale(t0, p0, p) : dragRotate(t0, p0, p));
  };
  const up = (e: RPointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  // Cuộn chuột = phóng (listener thường, passive: false để chặn cuộn trang).
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; });
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const wheel = (e: WheelEvent) => {
      if (disabled) return;
      e.preventDefault();
      const t0 = tRef.current;
      setT(normTransform({ ...t0, scale: t0.scale * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP) }, quad));
    };
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => cv.removeEventListener('wheel', wheel);
  }, [disabled, quad, setT]);

  return (
    <div ref={wrap} className="flex w-full justify-center">
      <canvas
        ref={canvas} tabIndex={0} role="img" data-testid="layer-canvas" data-transform={JSON.stringify(t)}
        aria-label="Your pet in the frame. Drag to move, drag a corner to resize, drag the round handle to rotate. Keyboard: arrow keys move, plus and minus zoom, [ and ] rotate."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ width: css?.w ?? '100%', height: css?.h, aspectRatio: css ? undefined : `${tw} / ${th}`, cursor }}
        className="block touch-none select-none rounded-md bg-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      />
    </div>
  );
}

function EditorBody({ layered, onSave, onCancel, onReplace }: Omit<Props, 'open'>) {
  const { template } = layered;
  const quad = template.quad, tw = template.size.w;
  const [imgs, setImgs] = useState<Imgs | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [start] = useState(() => normTransform(layered.transform, quad));
  const reset = normTransform(layered.cutout.default_transform ?? start, quad);
  const [t, setTRaw] = useState(start);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setT = useCallback((n: PetTransform) => { setTRaw(n); setErr(null); }, []);
  const set = (p: Partial<PetTransform>) => setT(normTransform({ ...t, ...p }, quad));

  useEffect(() => {
    let alive = true;
    const u = template.urls;
    Promise.all([load(u.base), load(u.overlay), load(layered.cutout.url), u.canvas_bg ? load(u.canvas_bg) : Promise.resolve(null)])
      .then(([base, overlay, pet, bg]) => { if (alive) setImgs({ base, overlay, pet, bg }); })
      .catch(() => { if (alive) setLoadErr(true); });
    return () => { alive = false; };
  }, [template.urls, layered.cutout.url, attempt]);

  const step = tw * MOVE_STEP;
  const moves: Record<'left' | 'up' | 'down' | 'right', Partial<PetTransform>> = {
    left: { x: t.x - step }, up: { y: t.y - step }, down: { y: t.y + step }, right: { x: t.x + step },
  };
  const onKey = (e: KeyboardEvent) => {
    if (saving || !(e.target instanceof HTMLCanvasElement)) return;
    const m = e.shiftKey ? 5 : 1;
    const k: Record<string, Partial<PetTransform>> = {
      ArrowLeft: { x: t.x - step * m }, ArrowRight: { x: t.x + step * m }, ArrowUp: { y: t.y - step * m }, ArrowDown: { y: t.y + step * m },
      '+': { scale: t.scale * ZOOM_STEP }, '=': { scale: t.scale * ZOOM_STEP }, '-': { scale: t.scale / ZOOM_STEP },
      '[': { rotate: t.rotate - ROTATE_STEP * m }, ']': { rotate: t.rotate + ROTATE_STEP * m },
    };
    if (k[e.key]) { e.preventDefault(); set(k[e.key]); }
  };

  async function ok() {
    if (saving) return;
    setSaving(true); setErr(null);
    try { await onSave(t); } catch (e) { setErr(e instanceof Error && e.message ? e.message : 'Couldn’t save your changes. Please try again.'); setSaving(false); }
  }

  const sizePct = Math.round((t.scale / (reset.scale || 1)) * 100);
  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKey}>
      <div className="bg-muted px-2 py-2 sm:px-4 sm:py-3" data-testid="layer-stage" aria-busy={!imgs || undefined}>
        {imgs ? (
          <Stage layered={layered} imgs={imgs} t={t} setT={setT} disabled={saving} />
        ) : (
          <div className="mx-auto flex max-h-[60dvh] w-full max-w-md items-center justify-center rounded-md bg-card" style={{ aspectRatio: `${tw} / ${template.size.h}` }}>
            {loadErr ? (
              <div role="alert" className="space-y-3 p-4 text-center text-sm">
                <p className="flex items-center justify-center gap-2 font-medium text-destructive"><AlertIcon className="shrink-0" /> We couldn&apos;t load the editor.</p>
                <button type="button" className={`${pill} border border-input bg-background hover:border-foreground`} onClick={() => { setLoadErr(false); setAttempt((a) => a + 1); }}>Try again</button>
              </div>
            ) : (
              <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderIcon /> Loading your portrait…</span>
            )}
          </div>
        )}
      </div>

      <p className="px-4 pt-2 text-center text-xs text-muted-foreground">Drag to move · drag a corner to resize · drag the round handle to rotate</p>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3 py-2" role="group" aria-label="Adjust your pet">
        <span className="flex gap-1">
          <ToolButton label="Rotate left" onStep={() => set({ rotate: t.rotate - ROTATE_STEP })}><RotateCcwIcon /></ToolButton>
          <ToolButton label="Rotate right" onStep={() => set({ rotate: t.rotate + ROTATE_STEP })}><RotateCwIcon /></ToolButton>
        </span>
        <span className="flex gap-1">
          <ToolButton label="Zoom out" onStep={() => set({ scale: t.scale / ZOOM_STEP })}><ZoomOutIcon /></ToolButton>
          <ToolButton label="Zoom in" onStep={() => set({ scale: t.scale * ZOOM_STEP })}><ZoomInIcon /></ToolButton>
        </span>
        <span className="flex gap-1">
          {(['left', 'up', 'down', 'right'] as const).map((d) => (
            <ToolButton key={d} label={`Move ${d}`} onStep={() => set(moves[d])}><ArrowIcon dir={d} size={18} /></ToolButton>
          ))}
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-[6.5rem] text-center text-xs tabular-nums text-muted-foreground" data-testid="layer-readout">Size {sizePct}% · {Math.round(t.rotate)}°</span>
          <button type="button" className="min-h-11 rounded-md px-3 text-sm font-medium underline underline-offset-2" onClick={() => setT(reset)}>Reset</button>
        </span>
      </div>

      {err && <p role="alert" className="flex justify-center gap-2 px-4 pb-1 text-sm font-medium text-destructive"><AlertIcon className="mt-0.5 shrink-0" /> {err}</p>}
      <div className="flex items-center gap-2 border-t border-border px-3 py-3 sm:px-5">
        <button type="button" onClick={onReplace} disabled={saving} className={`${pill} border border-input bg-background px-3 hover:border-foreground disabled:opacity-50 sm:px-4`}>
          <ImageUpIcon /> Replace photo
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onCancel} disabled={saving} className={`${pill} border border-input bg-background hover:border-foreground disabled:opacity-50`}>Cancel</button>
        <button
          type="button" onClick={ok} disabled={!imgs} aria-busy={saving || undefined} data-testid="layer-ok"
          className={`${pill} min-w-16 bg-accent sm:min-w-20 text-on-accent hover:bg-accent-hover disabled:bg-muted disabled:text-muted-foreground`}
        >
          {saving && <LoaderIcon size={18} />} OK
        </button>
      </div>
    </div>
  );
}

/** Dialog editor theo lớp. Mount nội dung chỉ khi mở → mỗi lần mở bắt đầu từ transform đã lưu. */
export function LayerEditor({ open, onCancel, ...p }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref} aria-labelledby="layer-edit-title" onClose={() => { if (open) onCancel(); }}
      data-testid="layer-editor"
      className="m-auto max-h-[calc(100dvh-1rem)] w-[min(46rem,calc(100vw-1rem))] max-w-none overflow-y-auto rounded-xl bg-background p-0 text-foreground shadow-xl backdrop:bg-primary/50"
    >
      <div className="flex items-center justify-between border-b border-border py-1.5 pl-5 pr-2">
        <h2 id="layer-edit-title" className="font-sans text-lg font-semibold">Adjust your pet</h2>
        <button type="button" aria-label="Close editor" onClick={onCancel} className="inline-flex size-11 items-center justify-center rounded-full transition-colors hover:bg-muted"><Icon name="x" size={22} /></button>
      </div>
      {open && <EditorBody onCancel={onCancel} {...p} />}
    </dialog>
  );
}

/** Kết quả v2 trên trang: ảnh gốc cạnh final để khách tự so, nút mở lại editor (không gen lại). */
export function LayeredPreview({ uploadUrl, finalUrl, onEdit }: { uploadUrl: string | null; finalUrl: string; onEdit?: () => void }) {
  return (
    <div className="space-y-3" data-testid="layered-preview">
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            {uploadUrl && <Image src={uploadUrl} alt="Your original photo" fill unoptimized sizes="(min-width: 1024px) 25vw, 50vw" className="object-contain" />}
          </div>
          <figcaption className="mt-1 text-center text-sm text-muted-foreground">Your photo</figcaption>
        </figure>
        <figure>
          <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            <Image src={finalUrl} alt="Your portrait preview" fill unoptimized sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
          </div>
          <figcaption className="mt-1 text-center text-sm text-muted-foreground">Your portrait</figcaption>
        </figure>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className={`${pill} w-full border border-input bg-background hover:border-foreground`} data-testid="layered-adjust">
          <MoveIcon /> Adjust position
        </button>
      )}
    </div>
  );
}
