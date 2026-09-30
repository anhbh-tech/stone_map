'use client';
// Preview (#1): ảnh gốc cạnh ảnh AI để khách tự so; xoay / zoom / kéo (có nút + phím thay cho kéo); mockup treo tường.
import Image from 'next/image';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DesignView } from '@/lib/types';
import type { Transform } from './api';
import { clamp } from '../pdp/logic';
import { ArrowIcon, RotateCcwIcon, RotateCwIcon } from '../pdp/icons';

export const IDENTITY: Transform = { rotate: 0, zoom: 1, x: 0, y: 0 };
const PAN = 0.04;

/** Mockup của server được render theo transform đã lưu; khi khách đang chỉnh khác mặc định, dùng mockup vẽ tại chỗ cho khớp. */
const transform0 = (t: Transform) => t.rotate === 0 && t.zoom === 1 && t.x === 0 && t.y === 0;

const tool = 'inline-flex size-11 items-center justify-center rounded-md border border-border bg-card text-card-foreground hover:bg-muted';

function Portrait({ src, t, alt }: { src: string; t: Transform; alt: string }) {
  return (
    <Image
      src={src} alt={alt} fill unoptimized draggable={false} sizes="(min-width: 1024px) 25vw, 50vw"
      className="pointer-events-none select-none object-cover"
      style={{ transform: `translate(${t.x * 100}%, ${t.y * 100}%) rotate(${t.rotate}deg) scale(${t.zoom})` }}
    />
  );
}

type Props = { design: DesignView; transform: Transform; onChange: (t: Transform) => void; sizeLabel: string; scale: number };

export function PreviewEditor({ design, transform: t, onChange, sizeLabel, scale }: Props) {
  const [view, setView] = useState<'compare' | 'wall'>('compare');
  const drag = useRef<{ x: number; y: number; t: Transform; w: number } | null>(null);
  const set = (p: Partial<Transform>) => {
    const n = { ...t, ...p };
    onChange({ rotate: ((n.rotate % 360) + 360) % 360, zoom: clamp(n.zoom, 1, 3), x: clamp(n.x, -0.5, 0.5), y: clamp(n.y, -0.5, 0.5) });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, t, w: e.currentTarget.clientWidth || 1 };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    set({ x: d.t.x + (e.clientX - d.x) / d.w, y: d.t.y + (e.clientY - d.y) / d.w });
  };
  const onKey = (e: KeyboardEvent) => {
    const k: Record<string, Partial<Transform>> = {
      ArrowLeft: { x: t.x - PAN }, ArrowRight: { x: t.x + PAN }, ArrowUp: { y: t.y - PAN }, ArrowDown: { y: t.y + PAN },
      '+': { zoom: t.zoom + 0.1 }, '=': { zoom: t.zoom + 0.1 }, '-': { zoom: t.zoom - 0.1 },
    };
    if (k[e.key]) { e.preventDefault(); set(k[e.key]); }
  };

  const preview = design.preview_url;
  if (!preview) return null;

  return (
    <div className="space-y-3" data-testid="preview-editor">
      <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Preview view">
        {(['compare', 'wall'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
            className="min-h-11 rounded-md px-4 text-sm font-medium aria-pressed:bg-primary aria-pressed:text-on-primary">
            {v === 'compare' ? 'Compare with photo' : 'On the wall'}
          </button>
        ))}
      </div>

      {view === 'compare' ? (
        <div className="grid grid-cols-2 gap-3">
          <figure>
            <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
              {design.upload_url && <Image src={design.upload_url} alt="Your original photo" fill unoptimized sizes="(min-width: 1024px) 25vw, 50vw" className="object-contain" />}
            </div>
            <figcaption className="mt-1 text-center text-sm text-muted-foreground">Your photo</figcaption>
          </figure>
          <figure>
            <div
              tabIndex={0}
              role="application"
              aria-label="AI portrait crop. Drag, or use arrow keys to move and plus or minus to zoom."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={onKey}
              className="relative aspect-square cursor-grab touch-none overflow-hidden rounded-lg border border-border bg-muted active:cursor-grabbing"
              data-testid="ai-preview"
            >
              <Portrait src={preview} t={t} alt="" />
            </div>
            <figcaption className="mt-1 text-center text-sm text-muted-foreground">AI portrait · printed area</figcaption>
          </figure>
        </div>
      ) : (
        <figure>
          <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {design.mockup_url && transform0(t) ? (
              <Image src={design.mockup_url} alt={`Your portrait hanging on a wall, ${sizeLabel} in`} fill unoptimized sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
            ) : (
              <>
                <div className="absolute inset-x-0 bottom-0 h-1/5 border-t border-border bg-card" aria-hidden />
                <div className="relative -mt-[12%] aspect-square border-[6px] border-primary bg-card shadow-lg" style={{ width: `${18 + 36 * scale}%` }}>
                  <div className="relative size-full overflow-hidden">
                    <Portrait src={preview} t={t} alt={`Your portrait on a wall, shown at ${sizeLabel} in scale`} />
                  </div>
                </div>
              </>
            )}
          </div>
          <figcaption className="mt-1 text-center text-sm text-muted-foreground">{sizeLabel} in, shown to scale above a sofa</figcaption>
        </figure>
      )}

      <div className="flex flex-wrap items-center gap-2" aria-label="Adjust portrait" role="group">
        <button type="button" className={tool} onClick={() => set({ rotate: t.rotate - 90 })} aria-label="Rotate left"><RotateCcwIcon /></button>
        <button type="button" className={tool} onClick={() => set({ rotate: t.rotate + 90 })} aria-label="Rotate right"><RotateCwIcon /></button>
        <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
          <span>Zoom</span>
          <input type="range" min={1} max={3} step={0.05} value={t.zoom} onChange={(e) => set({ zoom: Number(e.target.value) })} className="min-w-24 flex-1 accent-accent" aria-valuetext={`${Math.round(t.zoom * 100)}%`} />
        </label>
        <span className="flex gap-1">
          {(['left', 'up', 'down', 'right'] as const).map((d) => (
            <button key={d} type="button" className={tool} aria-label={`Move ${d}`}
              onClick={() => set(d === 'left' ? { x: t.x - PAN } : d === 'right' ? { x: t.x + PAN } : d === 'up' ? { y: t.y - PAN } : { y: t.y + PAN })}>
              <ArrowIcon dir={d} size={18} />
            </button>
          ))}
        </span>
        <button type="button" className="min-h-11 rounded-md px-3 text-sm font-medium underline underline-offset-2" onClick={() => onChange(IDENTITY)}>Reset</button>
      </div>
    </div>
  );
}
