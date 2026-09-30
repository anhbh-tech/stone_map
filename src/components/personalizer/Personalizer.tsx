'use client';
// Toàn bộ phần tương tác của PDP (JS client chỉ nằm ở đây, #8). Luồng: size → ảnh → AI hoặc designer → xác nhận → giỏ.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Addon, BundleTier, Variant } from '@/lib/catalog';
import type { DesignView, JobView, Settings } from '@/lib/types';
import { fmt } from '@/lib/money';
import { bundleRows, sizeScale } from '../pdp/logic';
import { AlertIcon, BrushIcon, LoaderIcon, SparklesIcon } from '../pdp/icons';
import { api, ApiError, type Transform } from './api';
import { Addons, BundlePicker, SizePicker, type AddonState } from './options';
import { UploadBox, type UploadState } from './UploadBox';
import { JobProgress } from './JobProgress';
import { IDENTITY, PreviewEditor } from './PreviewEditor';
import { StickyPreview } from './StickyPreview';

export type PersonalizerProps = {
  product: { id: number; title: string };
  variants: Variant[];
  initialVariantId: number;
  tiers: BundleTier[];
  addons: Addon[];
  settings: Pick<Settings, 'privacy' | 'preflight'> & { shopName: string; currency: string; styles: Settings['ai']['styles'] };
  delivery: ReactNode;
};

type Mode = 'ai' | 'designer';
const POLL_MS = 1500;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Network problem. Check your connection and try again.');

const step = 'space-y-3 scroll-mt-24';
const h2 = 'text-2xl font-semibold';
const input = 'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base';

export function Personalizer({ product, variants, initialVariantId, tiers, addons, settings, delivery }: PersonalizerProps) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(initialVariantId);
  const [qty, setQty] = useState(1);
  const [addonState, setAddonState] = useState<AddonState>({});
  const [mode, setMode] = useState<Mode>('ai');
  const [consent, setConsent] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [style, setStyle] = useState(settings.styles[0]?.id || '');
  const [petName, setPetName] = useState('');
  const [notes, setNotes] = useState('');
  const [design, setDesign] = useState<(DesignView & { upload_id: string }) | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [petConfirmed, setPetConfirmed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const setStage = (el: HTMLElement | null) => { stageRef.current = el; };
  const transformSave = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: Promise<unknown> | null }>({ timer: null, pending: null });

  const variant = variants.find((v) => v.id === variantId) || variants[0];
  const row = bundleRows(variant.price_cents, tiers).find((r) => r.qty === qty) || bundleRows(variant.price_cents, [])[0];
  const addonsCents = addons.filter((a) => addonState[a.id]?.on).reduce((n, a) => n + a.price_cents, 0);
  const uploaded = upload.status === 'done' ? upload.result : null;
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  const ready = mode === 'ai' && !!design && design.mode === 'ai' && !!design.preview_url && (design.status === 'ready' || design.status === 'confirmed');

  // Poll job mỗi 1.5 s cho tới khi xong (#2). Lỗi mạng tạm thời → thử lại, 3 lần liên tiếp mới báo.
  useEffect(() => {
    if (!job || !running) return;
    let fails = 0;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      try {
        const j = await api.job(job.id);
        if (!alive) return;
        fails = 0;
        setJob(j);
        if (j.status === 'succeeded' && j.design) setDesign((d) => (d ? { ...j.design!, upload_id: d.upload_id } : d));
        if (j.status === 'failed' || j.status === 'canceled') setGenError(j.error || 'We couldn’t finish this portrait.');
        if (j.status === 'queued' || j.status === 'running') t = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!alive) return;
        if (++fails >= 3) { setGenError(msg(e)); setJob(null); return; }
        t = setTimeout(tick, POLL_MS * 2);
      }
    };
    t = setTimeout(tick, POLL_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [job?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseSize(id: number) {
    setVariantId(id);
    const u = new URL(window.location.href);
    u.searchParams.set('variant', String(id));
    window.history.replaceState(null, '', u);
    if (design) api.patchDesign(design.id, { variant_id: id }).catch(() => {});
  }

  function chooseMode(m: Mode) {
    setMode(m);
    setPetConfirmed(false);
    setAddError(null);
  }

  async function onFile(f: File) {
    setUpload({ status: 'uploading', name: f.name });
    setDesign(null); setJob(null); setGenError(null); setPetConfirmed(false); setTransform(IDENTITY);
    try {
      setUpload({ status: 'done', name: f.name, result: await api.upload(f) });
    } catch (e) {
      setUpload({ status: 'error', name: f.name, message: msg(e) });
    }
  }

  /** Design gắn với ảnh hiện tại và đúng mode; đổi ảnh/mode → tạo design mới. */
  async function ensureDesign(m: Mode) {
    if (!uploaded) throw new Error('no upload');
    if (design && design.upload_id === uploaded.upload_id && design.mode === m) {
      const locked = design.status === 'confirmed' || design.status === 'in_review'; // API khoá style/transform ở các trạng thái này
      const d = await api.patchDesign(design.id, { ...(locked ? {} : { style }), pet_name: petName || undefined, notes: m === 'designer' ? notes || undefined : undefined, variant_id: variantId });
      const next = { ...d, upload_id: uploaded.upload_id };
      setDesign(next);
      return next;
    }
    const d = await api.createDesign({
      product_id: product.id, variant_id: variantId, upload_id: uploaded.upload_id, mode: m, style,
      pet_name: petName || undefined, notes: m === 'designer' ? notes || undefined : undefined, email: email || undefined,
    });
    const next = { ...d, upload_id: uploaded.upload_id };
    setDesign(next);
    return next;
  }

  async function generate() {
    setGenError(null); setPetConfirmed(false); setTransform(IDENTITY);
    try {
      const d = await ensureDesign('ai');
      setJob(await api.generate(d.id, style));
    } catch (e) {
      setGenError(msg(e));
    }
  }

  function changeTransform(t: Transform) {
    setTransform(t);
    const s = transformSave.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = null;
      if (design && design.status !== 'confirmed') s.pending = api.patchDesign(design.id, { transform: t }).catch(() => {});
    }, 600);
  }

  async function addToCart() {
    setAdding(true); setAddError(null);
    try {
      let d = design;
      if (mode === 'ai') {
        if (!d) throw new Error('no design');
        const s = transformSave.current;
        if (s.timer) { clearTimeout(s.timer); s.timer = null; if (d.status !== 'confirmed') await api.patchDesign(d.id, { transform }); }
        await s.pending;
        if (d.status !== 'confirmed') { d = { ...(await api.confirm(d.id)), upload_id: d.upload_id }; setDesign(d); }
      } else {
        d = await ensureDesign('designer');
        if (d.status !== 'in_review') { d = { ...(await api.submit(d.id)), upload_id: d.upload_id }; setDesign(d); }
      }
      await api.addLine({ variant_id: variantId, qty, design_id: d.id });
      router.push('/cart');
    } catch (e) {
      setAddError(msg(e));
      setAdding(false);
    }
  }

  const aiBlocked = mode === 'ai' && !!uploaded && !uploaded.preflight.ok;
  const generateReason = !uploaded ? 'Upload a photo of your pet first.' : aiBlocked ? 'This photo didn’t pass our check — see the note under the upload box.' : null;
  const atcReason =
    !uploaded ? 'Upload a photo of your pet to continue.'
      : mode === 'ai' && !ready ? 'Generate your preview to continue.'
      : !petConfirmed ? 'Tick “This is my pet” to continue.'
      : null;

  // Thanh dính trên mobile bám theo khung đang hiện ảnh: preview/tiến trình AI, hoặc ô upload.
  const previewOnStage = mode === 'ai' && (running || ready);
  const stylesName = settings.styles.find((s) => s.id === style)?.name;
  const stickySrc = ready ? design!.preview_url : uploaded?.url || null;
  const stickyDetail = running && job ? `${Math.round(job.progress * 100)}% · ${variant.size} in` : `${variant.size} in · ${fmt(row.total_cents, settings.currency)}`;

  return (
    <div className="space-y-8">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="price">
        <span className="text-2xl font-semibold">{fmt(variant.price_cents, settings.currency)}</span>
        {variant.compare_at_cents && variant.compare_at_cents > variant.price_cents && (
          <span className="text-muted-foreground"><span className="sr-only">Regular price </span><s>{fmt(variant.compare_at_cents, settings.currency)}</s></span>
        )}
        <span className="text-sm text-muted-foreground">{variant.size} in</span>
      </p>

      <section className={step} aria-labelledby="step-size">
        <h2 id="step-size" className={h2}>1. Choose a size</h2>
        <SizePicker variants={variants} value={variantId} onChange={chooseSize} currency={settings.currency} />
      </section>

      <section ref={previewOnStage ? undefined : setStage} className={step} aria-labelledby="step-photo">
        <h2 id="step-photo" className={h2}>2. Add your pet&apos;s photo</h2>
        <fieldset>
          <legend className="sr-only">How should we make your portrait?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              { m: 'ai' as const, title: 'Generate with AI', text: 'See a preview on this page and approve it before we print.', Icon: SparklesIcon },
              { m: 'designer' as const, title: 'Designer finish', text: 'A designer makes it by hand from your photo and notes, at no extra cost.', Icon: BrushIcon },
            ]).map(({ m, title, text, Icon }) => (
              <label key={m} className="flex min-h-11 cursor-pointer gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground hover:border-foreground has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => chooseMode(m)} className="sr-only" />
                <Icon className="mt-0.5 shrink-0 text-accent" />
                <span><span className="block font-semibold">{title}</span><span className="text-sm text-muted-foreground">{text}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <UploadBox
          shopName={settings.shopName} privacy={settings.privacy} minSidePx={settings.preflight.min_side_px}
          mode={mode} consent={consent} onConsent={setConsent} state={upload} onFile={onFile}
          onUseDesigner={() => chooseMode('designer')}
        />
      </section>

      <section className={step} aria-labelledby="step-style">
        <h2 id="step-style" className={h2}>3. {mode === 'ai' ? 'Pick a style' : 'Tell our designer about your pet'}</h2>
        {settings.styles.length > 0 && (
          <fieldset>
            <legend className="text-sm font-semibold">Style</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {settings.styles.map((s) => (
                <label key={s.id} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-border bg-card px-4 text-sm text-card-foreground hover:border-foreground has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
                  <input type="radio" name="style" value={s.id} checked={style === s.id} onChange={() => setStyle(s.id)} className="sr-only" />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor="pet-name" className="text-sm font-semibold">Pet&apos;s name <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input id="pet-name" className={`${input} mt-1`} value={petName} onChange={(e) => setPetName(e.target.value)} maxLength={40} autoComplete="off" />
        </div>
        {mode === 'designer' && (
          <div>
            <label htmlFor="designer-notes" className="text-sm font-semibold">Notes for the designer <span className="font-normal text-muted-foreground">(optional)</span></label>
            <textarea id="designer-notes" rows={3} maxLength={500} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. remove the leash, keep her pink collar" />
            <p className="text-xs text-muted-foreground">We&apos;ll email a proof for your approval before printing.</p>
          </div>
        )}

        <div ref={previewOnStage ? setStage : undefined} className="scroll-mt-24 space-y-3">
          {mode === 'ai' && (
            <>
              {!running && design?.status !== 'confirmed' && (
                <div>
                  <button
                    type="button" onClick={generate} disabled={!!generateReason}
                    aria-describedby={generateReason ? 'generate-reason' : undefined}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SparklesIcon /> {ready ? `Try again in ${stylesName || 'this style'}` : 'Generate with AI'}
                  </button>
                  {generateReason && <p id="generate-reason" className="mt-1 text-sm text-muted-foreground">{generateReason}</p>}
                </div>
              )}
              {genError && (
                <div role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertIcon className="mt-0.5 shrink-0" />
                  <p>{genError} You can try again, or{' '}
                    <button type="button" className="min-h-11 font-semibold underline underline-offset-2" onClick={() => chooseMode('designer')}>ask a designer to finish it</button>.
                  </p>
                </div>
              )}
              {running && job && (
                <JobProgress job={job} savedEmail={email} onEmail={async (e) => { if (design) await api.patchDesign(design.id, { email: e }); setEmail(e); }} />
              )}
              {ready && !running && (
                <PreviewEditor
                  design={design!} transform={transform} onChange={changeTransform}
                  sizeLabel={variant.size} scale={sizeScale(variant.size, variants.map((v) => v.size))}
                />
              )}
            </>
          )}
        </div>
      </section>

      <section className={step} aria-labelledby="step-extras">
        <h2 id="step-extras" className={h2}>4. Quantity &amp; extras</h2>
        <BundlePicker unitCents={variant.price_cents} tiers={tiers} qty={qty} onChange={setQty} currency={settings.currency} />
        <Addons addons={addons} currency={settings.currency} value={addonState} onChange={setAddonState} />
      </section>

      {delivery}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground" aria-label="Add to cart">
        {uploaded && (mode === 'designer' || ready) && (
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-accent" checked={petConfirmed} onChange={(e) => setPetConfirmed(e.target.checked)} data-testid="pet-confirm" />
            <span>
              <span className="font-semibold">This is my pet</span>
              <span className="block text-sm text-muted-foreground">
                {mode === 'ai'
                  ? 'I compared the portrait with my photo, it looks like my pet, and I approve it for printing.'
                  : 'The photo shows my own pet, and the designer can use it for this portrait.'}
              </span>
            </span>
          </label>
        )}
        <dl className="flex justify-between text-sm">
          <dt className="text-muted-foreground">{qty} × {variant.size} in{addonsCents ? ' + add-ons' : ''}</dt>
          <dd className="font-semibold" data-testid="line-total">{fmt(row.total_cents + addonsCents, settings.currency)}</dd>
        </dl>
        <button
          type="button" onClick={addToCart} disabled={!!atcReason || adding}
          aria-describedby={atcReason ? 'atc-reason' : undefined}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-5 font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {adding && <LoaderIcon />} {mode === 'designer' ? 'Send to designer & add to cart' : 'Add to cart'}
        </button>
        {atcReason && <p id="atc-reason" className="text-sm text-muted-foreground">{atcReason}</p>}
        {addError && <p role="alert" className="flex gap-2 text-sm text-destructive"><AlertIcon className="mt-0.5 shrink-0" /> {addError}</p>}
      </section>

      <StickyPreview target={stageRef} observeKey={`${previewOnStage}`} src={stickySrc} title={ready ? `Your ${product.title}` : running ? 'Making your portrait' : 'Your photo'} detail={stickyDetail} />
    </div>
  );
}
