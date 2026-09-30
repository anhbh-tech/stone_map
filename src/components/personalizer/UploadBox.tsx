'use client';
// Ô upload: dòng consent + thời gian lưu + link policy từ settings.privacy (#10); lỗi preflight hiện đỏ ngay dưới ô (#1).
import Image from 'next/image';
import { useRef, useState, type DragEvent } from 'react';
import type { Settings } from '@/lib/types';
import type { UploadResult } from './api';
import { AlertIcon, CheckIcon, LoaderIcon, UploadIcon } from '../pdp/icons';

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; name: string }
  | { status: 'done'; name: string; result: UploadResult }
  | { status: 'error'; name: string; message: string };

type Props = {
  shopName: string;
  privacy: Settings['privacy'];
  minSidePx: number;
  mode: 'ai' | 'designer';
  consent: boolean;
  onConsent: (v: boolean) => void;
  state: UploadState;
  onFile: (f: File) => void;
  onUseDesigner: () => void;
  /** Ảnh + nhãn cho thẻ media sau khi upload (vd. ảnh AI đã gen); mặc định là ảnh gốc. */
  thumb?: { src: string; alt: string; label: string; detail: string } | null;
  /** Có = hiện nút Edit (mở lại editor của ảnh đã có). */
  onEdit?: () => void;
  /** Lỗi "bắt buộc" từ nút Add to cart (id của đoạn lỗi), để ô chọn ảnh đọc được lỗi đó. */
  describedBy?: string;
  invalid?: boolean;
};

export const UPLOAD_ERROR_ID = 'upload-error';
export const CONSENT_ID = 'photo-consent';
export const PHOTO_INPUT_ID = 'photo-input';
export const PHOTO_CHANGE_ID = 'photo-change';
const mediaBtn = 'inline-flex min-h-11 items-center rounded-full border border-input bg-background px-4 text-sm font-semibold transition-colors duration-150 hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50';

export function UploadBox({ shopName, privacy, minSidePx, mode, consent, onConsent, state, onFile, onUseDesigner, thumb, onEdit, describedBy, invalid }: Props) {
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pf = state.status === 'done' ? state.result.preflight : null;
  const blocked = mode === 'ai' && pf && !pf.ok;
  const hasError = state.status === 'error' || !!blocked;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f && consent) onFile(f);
  };

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" id={CONSENT_ID} className="mt-0.5 size-5 shrink-0 accent-accent" checked={consent} onChange={(e) => onConsent(e.target.checked)} data-testid="consent" aria-describedby={!consent && describedBy ? describedBy : undefined} />
        <span>
          I agree that {shopName} may use this photo only to make my portrait. It is processed by {privacy.processors.join(', ')} and
          deleted {privacy.retention_days} days after upload. <a href={privacy.policy_path} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">Privacy policy</a>
        </span>
      </label>

      <input
        id={PHOTO_INPUT_ID}
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="peer sr-only"
        disabled={!consent || state.status === 'uploading'}
        aria-describedby={`upload-hint${hasError ? ' ' + UPLOAD_ERROR_ID : ''}${describedBy ? ' ' + describedBy : ''}`}
        aria-invalid={hasError || invalid || undefined}
        data-testid="photo-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      {state.status === 'done' ? (
        // Đã có ảnh: thumbnail (ảnh AI nếu đã gen) + Change (chọn ảnh khác, gen lại) + Edit (mở lại editor, không gen lại).
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground" data-testid="media-card">
          <Image src={thumb?.src || state.result.url} alt={thumb?.alt || 'Your uploaded pet photo'} width={64} height={64} unoptimized className="size-16 shrink-0 rounded-md bg-muted object-cover" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{thumb?.label || state.name}</span>
              {pf?.ok && <CheckIcon size={16} className="shrink-0 text-success" aria-label="Photo checked" />}
            </span>
            <span id="upload-hint" className="block text-xs text-muted-foreground">{thumb?.detail || (pf?.ok ? 'Original photo · looks good' : 'Original photo')}</span>
          </span>
          <span className="flex shrink-0 gap-1.5">
            <button
              type="button" id={PHOTO_CHANGE_ID} onClick={() => fileRef.current?.click()} disabled={!consent}
              aria-label="Change photo" data-testid="media-change"
              className={mediaBtn}
            >Change</button>
            {onEdit && (
              <button type="button" onClick={onEdit} aria-label="Edit portrait" data-testid="media-edit" className={mediaBtn}>Edit</button>
            )}
          </span>
        </div>
      ) : (
        <label
          htmlFor={PHOTO_INPUT_ID}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
            hasError || invalid ? 'border-destructive' : drag ? 'border-primary bg-muted' : 'border-border bg-card'
          } ${consent ? 'cursor-pointer hover:border-foreground' : 'cursor-not-allowed'}`}
        >
          {state.status === 'uploading' ? (
            <span className="flex items-center gap-2" role="status"><LoaderIcon /> Checking your photo…</span>
          ) : (
            <>
              <UploadIcon size={28} className="text-muted-foreground" />
              <span className="font-medium">{consent ? 'Choose a photo or drop it here' : 'Tick the box above to upload a photo'}</span>
            </>
          )}
          <span id="upload-hint" className="text-xs text-muted-foreground">
            JPG, PNG or WebP · one pet, face clearly visible · at least {minSidePx}px on the short side
          </span>
        </label>
      )}

      {state.status === 'error' && (
        <div id={UPLOAD_ERROR_ID} role="alert" className="flex gap-2 text-sm font-medium text-destructive">
          <AlertIcon className="mt-0.5 shrink-0" />
          <p>{state.message}</p>
        </div>
      )}
      {pf && !pf.ok && (
        mode === 'ai' ? (
          <div id={UPLOAD_ERROR_ID} role="alert" className="space-y-2 text-sm text-destructive" data-testid="preflight-error">
            <p className="flex gap-2 font-semibold"><AlertIcon className="mt-0.5 shrink-0" /> We can&apos;t generate a portrait from this photo</p>
            <ul className="ml-7 list-disc space-y-1">
              {pf.issues.map((i) => <li key={i.code}>{i.message}</li>)}
            </ul>
            <p className="ml-7 text-foreground">
              Try another photo, or{' '}
              <button type="button" onClick={onUseDesigner} className="min-h-11 font-semibold underline underline-offset-2">
                let a designer finish it by hand
              </button>.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted p-3 text-sm">
            <p className="font-medium">Our designer will look at this photo closely:</p>
            <ul className="ml-5 mt-1 list-disc text-muted-foreground">
              {pf.issues.map((i) => <li key={i.code}>{i.message}</li>)}
            </ul>
            <p className="mt-1 text-muted-foreground">If it can&apos;t be used we&apos;ll email you before anything is printed.</p>
          </div>
        )
      )}
    </div>
  );
}
