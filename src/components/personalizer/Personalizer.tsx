'use client';
// Toàn bộ phần tương tác của PDP (JS client chỉ nằm ở đây, #8). Luồng: size → ảnh → AI hoặc designer → xác nhận → giỏ.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Addon, BundleTier, Variant } from '@/lib/catalog';
import type { DesignView, Settings } from '@/lib/types';
import { fmt } from '@/lib/money';
import { livePrice, sizeScale } from '../pdp/logic';
import { AlertIcon, BrushIcon, LoaderIcon, SparklesIcon } from '../pdp/icons';
import { api, ApiError, layeredOf, type JobViewV2, type PetTransform, type Transform, type UploadResult } from './api';
import { Addons, BundlePicker, QuantitySelect, SizePicker, type AddonState } from './options';
import { CONSENT_ID, PHOTO_CHANGE_ID, PHOTO_INPUT_ID, UploadBox, type UploadState } from './UploadBox';
import { useDesignEditor } from './editor';
import { JobProgress } from './JobProgress';
import { IDENTITY, PreviewEditor } from './PreviewEditor';
import { LayeredPreview, LayerEditor } from './LayerEditor';
import { StickyPreview } from './StickyPreview';
import { StickyBuy } from './StickyBuy';
import { Price } from './Price';

export type PersonalizerProps = {
  product: { id: number; title: string };
  variants: Variant[];
  initialVariantId: number;
  tiers: BundleTier[];
  addons: Addon[];
  settings: Pick<Settings, 'privacy' | 'preflight'> & { shopName: string; currency: string; styles: Settings['ai']['styles'] };
  delivery: ReactNode;
  /** Tiêu đề (h1), phụ đề, rating — render ở server, đặt ngay trên giá. */
  header?: ReactNode;
  /** Trần số lượng của cart API (MAX_QTY ở src/lib/cart.ts) — ô "10+" không cho vượt. */
  maxQty?: number;
};

/** Điều kiện bắt buộc trước khi thêm giỏ; nút Add to cart không bao giờ disabled, bấm thiếu → báo lỗi ngay dưới nhóm đó. */
type Req = 'photo' | 'generate' | 'confirm';
const REQ_ERR: Record<Req, string> = { photo: 'req-photo-error', generate: 'req-generate-error', confirm: 'req-confirm-error' };

type Mode = 'ai' | 'designer';
const POLL_MS = 1500;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Network problem. Check your connection and try again.');

const step = 'space-y-3 scroll-mt-24 lg:scroll-mt-40';
const h2 = 'font-sans text-lg font-semibold';
const input = 'min-h-11 w-full rounded-md border border-input bg-background px-3 text-base';
// Lựa chọn đang chọn = viền + nền đỏ nhạt (PRODUCT.md: đỏ cho lựa chọn đang chọn).
export const selectedCls = 'has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:ring-1 has-[:checked]:ring-accent';
// Focus bàn phím của lựa chọn = viền đỏ, cùng họ với trạng thái đang chọn.
export const focusCls = 'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent';

function ReqError({ req, text }: { req: Req; text: string }) {
  return (
    <p id={REQ_ERR[req]} role="alert" className="flex gap-2 text-sm font-semibold text-destructive" data-testid="req-error">
      <AlertIcon className="mt-0.5 shrink-0" /> {text}
    </p>
  );
}

export function Personalizer({ product, variants, initialVariantId, tiers, addons, settings, delivery, header, maxQty = 10 }: PersonalizerProps) {
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
  const [job, setJob] = useState<JobViewV2 | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [petConfirmed, setPetConfirmed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [reqErr, setReqErr] = useState<Req | null>(null);
  const editor = useDesignEditor();
  const resultRef = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(false);
  const stageRef = useRef<HTMLElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLElement>(null);
  const buyRef = useRef<HTMLElement>(null);
  const setStage = (el: HTMLElement | null) => { stageRef.current = el; };
  const transformSave = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: Promise<unknown> | null }>({ timer: null, pending: null });

  const variant = variants.find((v) => v.id === variantId) || variants[0];
  const addonsCents = addons.filter((a) => addonState[a.id]?.on).reduce((n, a) => n + a.price_cents, 0);
  const price = livePrice(variant, qty, tiers, addonsCents);
  const uploaded = upload.status === 'done' ? upload.result : null;
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  const ready = mode === 'ai' && !!design && design.mode === 'ai' && !!design.preview_url && (design.status === 'ready' || design.status === 'confirmed');
  // v2: final theo lớp (template + cutout) → editor canvas; v1 → PreviewEditor cũ.
  const layered = ready ? layeredOf(design) : null;

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
        if (j.status === 'succeeded' && j.design) {
          setDesign((d) => (d ? { ...j.design!, upload_id: d.upload_id } : d));
          if (layeredOf(j.design)) editor.openEditor(); // v2: mở editor ngay khi có final mặc định (như pearl_compare)
        }
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

  // Modal AI Filter đóng (job xong/lỗi) → đưa focus tới kết quả, không để rơi về <body>.
  useEffect(() => {
    if (wasRunning.current && !running) requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: false }));
    wasRunning.current = running;
  }, [running]);

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
    // "Change" sau khi đã gen: ảnh mới qua preflight thì gen lại luôn với cùng style.
    const rerun = mode === 'ai' && !!design && design.mode === 'ai' && (!!design.preview_url || !!job);
    setUpload({ status: 'uploading', name: f.name });
    setDesign(null); setJob(null); setGenError(null); setPetConfirmed(false); setTransform(IDENTITY);
    try {
      const result = await api.upload(f);
      setUpload({ status: 'done', name: f.name, result });
      if (rerun && result.preflight.ok) await generate(result, null);
    } catch (e) {
      setUpload({ status: 'error', name: f.name, message: msg(e) });
    }
  }

  /** Design gắn với ảnh hiện tại và đúng mode; đổi ảnh/mode → tạo design mới. `current` = design đang giữ (null = bắt buộc tạo mới). */
  async function ensureDesign(m: Mode, up: UploadResult | null = uploaded, current = design) {
    const uploaded = up, design = current;
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

  async function generate(up: UploadResult | null = uploaded, current = design) {
    setGenError(null); setPetConfirmed(false); setTransform(IDENTITY);
    try {
      const d = await ensureDesign('ai', up, current);
      setJob(await api.generate(d.id, style));
    } catch (e) {
      setGenError(msg(e));
    }
  }

  /** OK trong editor theo lớp: server render final mới; design mới thay ảnh trên trang. */
  async function saveLayered(t: PetTransform) {
    if (!design) return;
    const d = await api.render(design.id, t);
    setDesign({ ...d, upload_id: design.upload_id });
    editor.closeEditor();
  }

  /** Replace photo trong editor: đóng editor, mở chọn ảnh (cùng luồng với Change → gen lại). */
  function replacePhoto() {
    editor.closeEditor();
    document.getElementById(PHOTO_INPUT_ID)?.click();
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

  /** Bấm Add to cart/Generate khi còn thiếu: hiện lỗi dưới nhóm đó, cuộn tới và focus vào ô cần làm. */
  function demand(r: Req) {
    setReqErr(r);
    const id = r === 'photo' ? (!consent ? CONSENT_ID : uploaded ? PHOTO_CHANGE_ID : PHOTO_INPUT_ID) : r === 'generate' ? 'generate-btn' : 'pet-confirm';
    const el = document.getElementById(id);
    const box = r === 'photo' ? photoRef.current : el;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    box?.scrollIntoView({ behavior, block: r === 'photo' ? 'start' : 'center' });
    el?.focus({ preventScroll: true });
  }

  function tryGenerate() {
    if (missing.photo) return demand('photo');
    setReqErr(null);
    generate();
  }

  async function addToCart() {
    if (adding) return;
    const first = (['photo', 'generate', 'confirm'] as const).find((r) => missing[r]);
    if (first) return demand(first);
    setReqErr(null);
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
  const missing: Record<Req, boolean> = { photo: !uploaded || aiBlocked, generate: mode === 'ai' && !ready, confirm: !petConfirmed };
  // Lỗi chỉ hiện sau khi bấm, và tự tắt khi điều kiện đó đã đủ.
  const shownErr = reqErr && missing[reqErr] && !(reqErr !== 'photo' && missing.photo) ? reqErr : null;
  const photoErrText = mode === 'ai' ? 'Generate with AI is required' : 'A photo of your pet is required';
  const atcLabel = mode === 'designer' ? 'Send to designer & add to cart' : 'Add to cart';

  // Thanh dính trên mobile bám theo khung đang hiện ảnh: preview/tiến trình AI, hoặc ô upload.
  const previewOnStage = mode === 'ai' && (running || ready);
  const stylesName = settings.styles.find((s) => s.id === style)?.name;
  const stickySrc = ready ? design!.preview_url : uploaded?.url || null;
  const stickyDetail = running && job ? `${Math.round(job.progress * 100)}% · ${variant.size} in` : `${variant.size} in · ${fmt(price.price_cents, settings.currency)}`;
  const priceNote = [qty > 1 ? `for ${qty} portraits` : null, addonsCents ? 'add-ons included' : null].filter(Boolean).join(', ');
  const scale = sizeScale(variant.size, variants.map((v) => v.size));

  return (
    <div className="space-y-8">
      <div ref={priceRef} className="space-y-3">
        {header}
        <Price price={price} currency={settings.currency} note={priceNote} />
      </div>

      <section className={step} aria-label="Size">
        <SizePicker variants={variants} value={variantId} onChange={chooseSize} currency={settings.currency} />
      </section>

      <section ref={(el) => { photoRef.current = el; if (!previewOnStage) setStage(el); }} className={step} aria-labelledby="step-photo">
        <h2 id="step-photo" className={h2}>
          Choose Creation Method{' '}
          <span className="block text-sm font-normal text-muted-foreground sm:inline">(If AI fails, upload original photo for designers)</span>
        </h2>
        <fieldset className="min-w-0" aria-labelledby="step-photo" aria-describedby={shownErr === 'photo' ? REQ_ERR.photo : undefined}>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              { m: 'ai' as const, title: 'Generate with AI', text: 'See a preview on this page and approve it before we print.', Icon: SparklesIcon },
              { m: 'designer' as const, title: 'Designer finish', text: 'A designer makes it by hand from your photo and notes, at no extra cost.', Icon: BrushIcon },
            ]).map(({ m, title, text, Icon }) => (
              <label key={m} className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border border-input bg-card p-4 text-card-foreground transition-colors duration-150 hover:border-foreground ${selectedCls} ${focusCls}`} data-testid="mode-option">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => chooseMode(m)} className="sr-only" />
                <Icon className="mt-0.5 shrink-0 text-foreground" />
                <span><span className="block font-semibold">{title}</span><span className="text-sm text-muted-foreground">{text}</span></span>
              </label>
            ))}
          </div>
          {shownErr === 'photo' && <div className="mt-2"><ReqError req="photo" text={photoErrText} /></div>}
        </fieldset>
        <UploadBox
          shopName={settings.shopName} privacy={settings.privacy} minSidePx={settings.preflight.min_side_px}
          mode={mode} consent={consent} onConsent={setConsent} state={upload} onFile={onFile}
          onUseDesigner={() => chooseMode('designer')}
          thumb={ready ? { src: design!.preview_url!, alt: `Your ${stylesName || 'AI'} portrait preview`, label: 'AI portrait', detail: `${stylesName || 'AI'} style · ${upload.status === 'done' ? upload.name : 'your photo'}` } : null}
          onEdit={ready && design!.status !== 'confirmed' ? editor.openEditor : undefined}
          describedBy={shownErr === 'photo' ? REQ_ERR.photo : undefined} invalid={shownErr === 'photo'}
        />
      </section>

      <section className={step} aria-labelledby="step-style">
        <h2 id="step-style" className={h2}>{mode === 'ai' ? 'Pick a style' : 'Tell our designer about your pet'}</h2>
        {settings.styles.length > 0 && (
          <fieldset className="min-w-0">
            <legend className="text-sm font-semibold">Style</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {settings.styles.map((s) => (
                <label key={s.id} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border border-input bg-card px-4 text-sm font-medium text-card-foreground transition-colors duration-150 hover:border-foreground ${selectedCls} ${focusCls}`}>
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
            <textarea id="designer-notes" rows={3} maxLength={500} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. remove the leash, keep her pink collar" />
            <p className="text-xs text-muted-foreground">We&apos;ll email a proof for your approval before printing.</p>
          </div>
        )}

        <div ref={previewOnStage ? setStage : undefined} className="scroll-mt-24 space-y-3">
          {mode === 'ai' && (
            <>
              {!running && design?.status !== 'confirmed' && (
                <div>
                  <button
                    type="button" id="generate-btn" onClick={tryGenerate}
                    aria-describedby={shownErr === 'generate' ? REQ_ERR.generate : aiBlocked ? 'upload-error' : undefined}
                    aria-invalid={shownErr === 'generate' || undefined}
                    className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-5 font-semibold transition-colors duration-150 focus-visible:outline-accent ${
                      ready ? 'border border-input bg-background hover:border-foreground' : 'bg-primary text-on-primary hover:bg-secondary'
                    }`}
                  >
                    <SparklesIcon /> {ready ? 'Regenerate' : 'Generate with AI'}
                  </button>
                  {shownErr === 'generate' && <div className="mt-2"><ReqError req="generate" text="Generate with AI is required" /></div>}
                </div>
              )}
              {genError && (
                <div role="alert" className="flex gap-2 text-sm text-destructive">
                  <AlertIcon className="mt-0.5 shrink-0" />
                  <p>{genError} You can try again, or{' '}
                    <button type="button" className="min-h-11 font-semibold underline underline-offset-2" onClick={() => chooseMode('designer')}>upload your original photo for our designers</button>.
                  </p>
                </div>
              )}
              {running && job && (
                <JobProgress job={job} savedEmail={email} onEmail={async (e) => { if (design) await api.patchDesign(design.id, { email: e }); setEmail(e); }} />
              )}
              <div ref={resultRef} tabIndex={-1} className="outline-none" aria-label={ready ? 'Your portrait preview' : undefined}>
                {ready && !running && (layered ? (
                  <LayeredPreview uploadUrl={design!.upload_url} finalUrl={design!.preview_url!} onEdit={design!.status !== 'confirmed' ? editor.openEditor : undefined} />
                ) : (
                  <PreviewEditor design={design!} transform={transform} onChange={changeTransform} sizeLabel={variant.size} scale={scale} />
                ))}
              </div>
              {layered && (
                <LayerEditor open={editor.open} layered={layered} onSave={saveLayered} onCancel={editor.closeEditor} onReplace={replacePhoto} />
              )}
              {ready && !layered && (
                <editor.Editor
                  open={editor.open} onClose={editor.closeEditor}
                  design={design!} transform={transform} onChange={changeTransform} sizeLabel={variant.size} scale={scale}
                />
              )}
            </>
          )}
        </div>
      </section>

      <section className={step} aria-labelledby="step-extras">
        <h2 id="step-extras" className={h2}>Quantity &amp; extras</h2>
        <BundlePicker unitCents={variant.price_cents} tiers={tiers} qty={qty} onChange={setQty} currency={settings.currency} />
        <Addons addons={addons} currency={settings.currency} value={addonState} onChange={setAddonState} />
      </section>

      {delivery}

      <section ref={buyRef} className="scroll-mt-24 space-y-3 lg:scroll-mt-40" aria-label="Add to cart">
        {uploaded && (mode === 'designer' || ready) && (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox" id="pet-confirm" className="mt-0.5 size-5 shrink-0 accent-accent" checked={petConfirmed} onChange={(e) => setPetConfirmed(e.target.checked)} data-testid="pet-confirm"
              aria-invalid={shownErr === 'confirm' || undefined} aria-describedby={shownErr === 'confirm' ? REQ_ERR.confirm : undefined}
            />
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
        {shownErr === 'confirm' && <ReqError req="confirm" text="Please confirm this is your pet" />}
        <div className="flex gap-2">
          <QuantitySelect qty={qty} max={maxQty} onChange={setQty} />
          <button
            type="button" onClick={addToCart} aria-busy={adding || undefined}
            className="inline-flex min-h-13 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 text-lg font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-accent"
          >
            {adding && <LoaderIcon />} <span className="truncate">{atcLabel}</span>
          </button>
        </div>
        {addError && <p role="alert" className="flex gap-2 text-sm text-destructive"><AlertIcon className="mt-0.5 shrink-0" /> {addError}</p>}
      </section>

      <StickyBuy
        watch={[priceRef, buyRef]}
        price={price} currency={settings.currency}
        label={atcLabel}
        busy={adding}
        onClick={addToCart}
      />
      <StickyPreview target={stageRef} observeKey={`${previewOnStage}`} src={stickySrc} title={ready ? `Your ${product.title}` : running ? 'Making your portrait' : 'Your photo'} detail={stickyDetail} />
    </div>
  );
}
