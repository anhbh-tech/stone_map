// InfoTabs trên PDP: nội dung theo sản phẩm + mặc định store, size từ variants, Shipping & Returns từ settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-info-'));
process.env.DB_PATH = path.join(dir, 'store.db');
const { db } = await import('./db');
const { DEFAULTS } = await import('./settings');
const I = await import('./info-tabs');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const d = db();
const pid = (d.prepare("INSERT INTO products (handle, title) VALUES ('pearl-pet-portrait', 'Pearl Pet Portrait') RETURNING id").get() as { id: number }).id;
const product = { title: 'Pearl Pet Portrait', frame_included: 0, variants: ['8×8', '12×12', '16×16', '20×20'].map((size) => ({ size })) };
const text = (r: import('./info-tabs').Rich) => r.map((s) => s.text).join('');
const resolve = (p: Partial<Parameters<typeof I.resolveInfo>[0]> = {}) =>
  I.resolveInfo({ product, override: {}, defaults: I.INFO_DEFAULTS, settings: structuredClone(DEFAULTS), hasFrameAddon: true, ...p });

describe('sizeLabel', () => {
  it('shows inches with centimetres and flags square sizes', () => {
    expect(I.sizeLabel('12×12')).toEqual({ label: '12×12 in (30×30 cm)', square: true });
    expect(I.sizeLabel('8x10 in')).toEqual({ label: '8×10 in (20×25 cm)', square: false });
    expect(I.sizeLabel('Ornament')).toEqual({ label: 'Ornament', square: false });
  });
});

describe('rich', () => {
  it('turns **bold** and tokens into segments, the support email into a mailto link', () => {
    expect(I.rich('**{product}** ships. Ask {support_email}', { product: 'Kit', support_email: 'care@x.test' })).toEqual([
      { text: 'Kit', bold: true },
      { text: ' ships. Ask ' },
      { text: 'care@x.test', href: 'mailto:care@x.test' },
    ]);
    expect(I.rich('{unknown} ** x', {})).toEqual([{ text: '{unknown} ** x' }]);
  });
});

describe('resolveInfo', () => {
  it('builds Description from the store default, with sizes from the variants', () => {
    const r = resolve();
    expect(r.paragraphs).toHaveLength(2);
    expect(r.paragraphs[0][0]).toEqual({ text: 'Pearl Pet Portrait', bold: true });
    expect(r.sizesLabel).toBe('Available in four square sizes:');
    expect(r.sizes).toEqual(['8×8 in (20×20 cm)', '12×12 in (30×30 cm)', '16×16 in (41×41 cm)', '20×20 in (51×51 cm)']);
    expect(text(r.tips[4])).toContain('3 days');
    expect(resolve({ product: { ...product, variants: [{ size: '8×10' }] } }).sizesLabel).toBe('Available in one size:');
  });

  it('only promises a frame that exists', () => {
    expect(text(resolve({ product: { ...product, frame_included: 1 } }).warmTip!)).toMatch(/arrives in its frame/);
    expect(text(resolve().warmTip!)).toMatch(/sold separately/);
    expect(resolve({ hasFrameAddon: false }).warmTip).toBeNull();
    expect(text(resolve({ override: { warm_tip: 'Hang it high.' }, hasFrameAddon: false }).warmTip!)).toBe('Hang it high.');
  });

  it('lets a product override text while unset fields keep the default', () => {
    const r = resolve({ override: { description: 'Hand **picked**.', tips: ['One'] } });
    expect(r.paragraphs).toEqual([[{ text: 'Hand ' }, { text: 'picked', bold: true }, { text: '.' }]]);
    expect(r.tips.map(text)).toEqual(['One']);
    expect(r.gift.map(text)).toEqual([I.INFO_DEFAULTS.gift]);
  });

  it('writes Shipping & Returns from settings: delivery days, edit window, free threshold, support email', () => {
    const s = structuredClone(DEFAULTS);
    const lines = resolve({ settings: s }).shipping.map(text);
    expect(lines[0]).toBe('Estimated delivery: 8–11 days with Standard or 5–7 days with Express, including 3 days to make your piece after you approve the preview. Carriers do not deliver on most weekends and public holidays, so those can add a day or two.');
    expect(lines[1]).toContain('email care@pearlatelier.test within 4 hours');
    expect(lines[2]).toBe('Free shipping: Free US shipping on orders over $79.99. Below that, Standard is $6.99.');
    expect(lines.some((l) => l.includes('customs'))).toBe(false); // chỉ ship US: không nói chuyện quốc tế

    s.shipping = { ...s.shipping, regions: ['US', 'CA'], free_over_cents: null };
    s.shop.support_email = 'hello@shop.test';
    const intl = resolve({ settings: s, defaults: { ...I.INFO_DEFAULTS, edit_hours: 1 } }).shipping;
    expect(intl.map(text)).toContain('International orders can take longer to arrive while they clear customs.');
    expect(text(intl[1])).toContain('within 1 hour of');
    expect(intl[1]).toContainEqual({ text: 'hello@shop.test', href: 'mailto:hello@shop.test' });
    expect(text(intl[2])).toBe('Shipping: Shipping to US, CA. Standard is $6.99, Express $19.99.');
  });
});

describe('storage', () => {
  it('falls back to built-in defaults and merges a saved store default', () => {
    expect(I.getInfoDefaults()).toEqual(I.INFO_DEFAULTS);
    I.setInfoDefaults({ ...I.INFO_DEFAULTS, edit_hours: 6 });
    expect(I.getInfoDefaults().edit_hours).toBe(6);
  });

  it('stores only the fields a product overrides, NULL when none', () => {
    expect(I.setProductInfo(pid, I.productInfoSchema.parse({ description: 'Mine', gift: '', tips: 'Sharp photo, good light\n\nName check' }))).toBe(true);
    expect(I.getProductInfo(pid)).toEqual({ description: 'Mine', tips: ['Sharp photo, good light', 'Name check'] });
    I.setProductInfo(pid, I.productInfoSchema.parse({ description: '', tips: '' }));
    expect(d.prepare('SELECT info_tabs FROM products WHERE id = ?').get(pid)).toEqual({ info_tabs: null });
    expect(I.setProductInfo(pid + 999, {})).toBe(false);
  });

  it('validates admin input', () => {
    expect(I.infoDefaultsSchema.safeParse({ ...I.INFO_DEFAULTS, extra: 1 }).success).toBe(false);
    expect(I.infoDefaultsSchema.safeParse({ ...I.INFO_DEFAULTS, tips: [] }).success).toBe(true);
    expect(I.productInfoSchema.safeParse({ description: 'x'.repeat(3001) }).success).toBe(false);
  });
});
