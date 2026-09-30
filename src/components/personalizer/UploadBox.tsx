'use client';
// Ô upload: dòng consent + thời gian lưu + link policy từ settings.privacy (#10); lỗi preflight hiện đỏ ngay dưới ô (#1).
import Image from 'next/image';
import { useState, type DragEvent } from 'react';
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
};

export const UPLOAD_ERROR_ID = 'upload-error';

export function UploadBox({ shopName, privacy, minSidePx, mode, consent, onConsent, state, onFile, onUseDesigner }: Props) {
  const [drag, setDrag] = useState(false);
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
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-accent" checked={consent} onChange={(e) => onConsent(e.target.checked)} data-testid="consent" />
        <span>
          I agree that {shopName} may use this photo only to make my portrait. It is processed by {privacy.processors.join(', ')} and
          deleted {privacy.retention_days} days after upload. <a href={privacy.policy_path} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">Privacy policy</a>
        </span>
      </label>

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
          hasError ? 'border-destructive' : drag ? 'border-primary bg-muted' : 'border-border bg-card'
        } ${consent ? 'cursor-pointer hover:border-foreground' : 'cursor-not-allowed'}`}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="sr-only"
          disabled={!consent || state.status === 'uploading'}
          aria-describedby={`upload-hint${hasError ? ' ' + UPLOAD_ERROR_ID : ''}`}
          aria-invalid={hasError || undefined}
          data-testid="photo-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
        {state.status === 'done' ? (
          <span className="flex w-full items-center gap-3 text-left">
            <Image src={state.result.url} alt="Your uploaded pet photo" width={64} height={64} unoptimized className="size-16 rounded-md object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{state.name}</span>
              <span className="text-sm text-muted-foreground underline underline-offset-2">Replace photo</span>
            </span>
            {pf?.ok && <CheckIcon className="text-success" />}
          </span>
        ) : state.status === 'uploading' ? (
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
