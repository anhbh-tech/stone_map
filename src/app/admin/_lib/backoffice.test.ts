// Back office (UI-3): trạng thái đơn, URL state của danh sách, số liệu Home, mã giảm giá, định dạng biểu đồ.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-backoffice-'));
process.env.DB_PATH = path.join(dir, 'store.db');
process.env.STORAGE_DIR = path.join(dir, 'storage');
const { db } = await import('../../../lib/db');
const { paymentStatus, fulfillmentStatus, STATUSES_FOR, canFulfill } = await import('./order-status');
const { listState, hrefWith, like, pages, offset, pick } = await import('./list');
const { rangeBounds, metricValue, change, overview, attention, sqlTime } = await import('./analytics');
const { discountState, evaluateDiscount, discountSummary } = await import('./discounts');
const { formatMetric, formatChange, niceMax } = await import('./metric-format');
const { searchOrders, orderTabCounts, orderTimeline, logOrderEvent } = await import('./orders');
const { customersReady, collectionsReady } = await import('./schema-info');
const { discountCreate, orderFulfill, designPatch } = await import('./schemas');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('order status', () => {
  it('derives payment and fulfillment from orders.status', () => {
    expect(['paid', 'in_production', 'shipped', 'delivered', 'refunded', 'canceled'].map(paymentStatus)).toEqual(['paid', 'paid', 'paid', 'paid', 'refunded', 'voided']);
    expect(['paid', 'in_production', 'shipped', 'delivered', 'refunded', 'canceled'].map(fulfillmentStatus)).toEqual(['unfulfilled', 'in_production', 'fulfilled', 'fulfilled', 'unfulfilled', 'unfulfilled']);
  });
  it('filter sets are the exact inverse of the derivation', () => {
    for (const [p, sts] of Object.entries(STATUSES_FOR.payment)) for (const s of sts) expect(paymentStatus(s)).toBe(p);
    for (const [f, sts] of Object.entries(STATUSES_FOR.fulfillment)) for (const s of sts) expect(fulfillmentStatus(s)).toBe(f);
  });
  it('only paid or in-production orders can be fulfilled', () => {
    expect(['paid', 'in_production'].every(canFulfill)).toBe(true);
    expect(['shipped', 'delivered', 'refunded', 'canceled'].some(canFulfill)).toBe(false);
  });
});

describe('list URL state', () => {
  it('parses and clamps search params', () => {
    expect(listState({ q: '  mochi ', sort: 'total', dir: 'asc', page: '3' }, ['date', 'total'] as const, 'date')).toEqual({ q: 'mochi', sort: 'total', dir: 'asc', page: 3, per: 25 });
    expect(listState({ sort: 'evil; DROP', dir: 'sideways', page: '-2' }, ['date'] as const, 'date')).toMatchObject({ sort: 'date', dir: 'desc', page: 1 });
    expect(pick(['a', 'b'], ['a', 'b'] as const)).toBe('a');
    expect(pick('z', ['a'] as const)).toBeUndefined();
  });
  it('keeps other params, drops empties and resets page when a filter changes', () => {
    expect(hrefWith('/admin/orders', { q: 'x', page: '4', tab: 'fulfilled' }, { sort: 'total' })).toBe('/admin/orders?q=x&tab=fulfilled&sort=total');
    expect(hrefWith('/admin/orders', { q: 'x', page: '4' }, { page: 5 })).toBe('/admin/orders?q=x&page=5');
    expect(hrefWith('/admin/orders', { q: 'x' }, { q: undefined })).toBe('/admin/orders');
  });
  it('escapes LIKE wildcards and computes pages', () => {
    expect(like('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(pages(0, 25)).toBe(1);
    expect(pages(51, 25)).toBe(3);
    expect(offset({ page: 3, per: 25 })).toBe(50);
  });
});

describe('analytics math', () => {
  const now = new Date('2026-09-30T15:30:00Z');
  it('ranges are UTC calendar days including today, previous period the same length', () => {
    const b = rangeBounds('7d', now);
    expect(b.start.toISOString()).toBe('2026-09-24T00:00:00.000Z');
    expect(b.prevStart.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(b.end.getTime() - b.start.getTime()).toBe(b.prevEnd.getTime() - b.prevStart.getTime());
    expect(b).toMatchObject({ unit: 'day', buckets: 7 });
    expect(rangeBounds('today', now)).toMatchObject({ unit: 'hour', buckets: 24 });
    expect(rangeBounds('today', now).start.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });
  it('AOV and conversion are null without a denominator, never 0 or NaN', () => {
    const zero = { revenue: 0, orders: 0, paid: 0, sessions: 0, converted: 0 };
    expect(metricValue('aov', zero)).toBeNull();
    expect(metricValue('conversion', zero)).toBeNull();
    expect(metricValue('aov', { ...zero, revenue: 10001, paid: 2 })).toBe(5001);
    expect(metricValue('conversion', { ...zero, sessions: 8, converted: 2 })).toBe(0.25);
  });
  it('change is relative and null when the previous period is empty', () => {
    expect(change(150, 100)).toBe(0.5);
    expect(change(50, 0)).toBeNull();
    expect(change(null, 10)).toBeNull();
  });
});

describe('overview and attention from the database', () => {
  const now = new Date();
  const ago = (h: number) => sqlTime(new Date(now.getTime() - h * 3600_000));
  beforeAll(() => {
    const d = db();
    const ins = d.prepare("INSERT INTO orders (number, email, name, address, shipping_method, subtotal_cents, total_cents, status, created_at) VALUES (?, ?, 'T', '{}', 'standard', ?, ?, ?, ?)");
    ins.run('9001', 'a@example.test', 5000, 5000, 'paid', ago(1));
    ins.run('9002', 'b@example.test', 7000, 7000, 'in_production', ago(2));
    ins.run('9003', 'c@example.test', 9000, 9000, 'refunded', ago(3));
    ins.run('9004', 'a@example.test', 3000, 3000, 'shipped', ago(24 * 8)); // kỳ trước của 7d
    const ev = d.prepare('INSERT INTO events (name, session_id, created_at) VALUES (?, ?, ?)');
    ev.run('page_viewed', 's1', ago(1)); ev.run('checkout_completed', 's1', ago(1));
    ev.run('page_viewed', 's2', ago(1)); ev.run('page_viewed', 's3', ago(2)); ev.run('page_viewed', 's4', ago(2));
  });
  it('revenue excludes refunds; orders counts every order; conversion uses sessions', () => {
    const o = overview('7d', now);
    const k = Object.fromEntries(o.kpis.map((x) => [x.metric, x]));
    expect(k.revenue.value).toBe(12000);
    expect(k.orders.value).toBe(3);
    expect(k.aov.value).toBe(6000);
    expect(k.conversion.value).toBe(0.25);
    expect(k.revenue.prev).toBe(3000);
    expect(k.revenue.change).toBe(3);
    expect(o.series.revenue).toHaveLength(7);
    expect(o.series.revenue.reduce((a, p) => a + (p.value ?? 0), 0)).toBe(12000);
  });
  it('attention counts real queues', () => {
    expect(attention()).toMatchObject({ to_fulfill: 2, not_started: 1 });
  });
  it('searchOrders filters by payment, fulfillment, customer email and number', () => {
    const s = { q: '', sort: 'date' as const, dir: 'desc' as const, page: 1, per: 25 };
    expect(searchOrders(s, { payment: 'refunded' }).rows.map((r) => r.number)).toEqual(['9003']);
    expect(searchOrders(s, { fulfillment: 'fulfilled' }).rows.map((r) => r.number)).toEqual(['9004']);
    expect(searchOrders(s, { email: 'A@example.test' }).total).toBe(2);
    expect(searchOrders({ ...s, q: '#9002' }).rows[0].fulfillment).toBe('in_production');
    expect(searchOrders({ ...s, q: '%' }).total).toBe(0);
    expect(orderTabCounts()).toMatchObject({ all: 4, to_fulfill: 1, in_production: 1, fulfilled: 1, refunded: 1 });
  });
  it('timeline merges placed, logged events and the confirmation email, newest first', () => {
    const id = (db().prepare("SELECT id FROM orders WHERE number = '9001'").get() as { id: number }).id;
    db().prepare("INSERT INTO email_outbox (to_addr, kind, subject, html, created_at) VALUES ('a@example.test', 'order_confirmation', 'Your shop order #9001', '', ?)").run(ago(0.9));
    db().prepare("INSERT INTO email_outbox (to_addr, kind, subject, html) VALUES ('a@example.test', 'order_confirmation', 'Your shop order #90010', '')").run();
    logOrderEvent(id, 'comment', 'Called the customer', 'admin');
    const t = orderTimeline(id);
    expect(t.map((e) => e.kind)).toEqual(['comment', 'email', 'placed']);
    expect(t[0].author).toBe('admin');
  });
  it('UI-2 tables are detected, not assumed', () => {
    expect(typeof customersReady()).toBe('boolean');
    expect(typeof collectionsReady()).toBe('boolean');
  });
});

describe('discounts', () => {
  const base = { id: 1, code: 'BUNDLE3', kind: 'percent' as const, value: 15, min_subtotal_cents: null, min_qty: 3, starts_at: null, ends_at: null, usage_limit: null, active: 1 as const, created_at: '2026-09-01 00:00:00' };
  const now = new Date('2026-09-30T12:00:00Z');
  it('state follows active flag, dates and usage', () => {
    expect(discountState(base, 0, now)).toBe('active');
    expect(discountState({ ...base, active: 0 }, 0, now)).toBe('disabled');
    expect(discountState({ ...base, starts_at: '2026-10-01 00:00:00' }, 0, now)).toBe('scheduled');
    expect(discountState({ ...base, ends_at: '2026-09-29 23:59:59' }, 0, now)).toBe('expired');
    expect(discountState({ ...base, usage_limit: 5 }, 5, now)).toBe('used_up');
  });
  it('evaluates minimums and never discounts below zero', () => {
    expect(evaluateDiscount(base, { subtotal_cents: 20000, qty: 2 }, 0, now)).toEqual({ ok: false, reason: 'min_qty' });
    expect(evaluateDiscount(base, { subtotal_cents: 20000, qty: 3 }, 0, now)).toEqual({ ok: true, discount_cents: 3000, free_shipping: false });
    expect(evaluateDiscount({ ...base, kind: 'fixed', value: 5000, min_qty: null }, { subtotal_cents: 3000, qty: 1 }, 0, now)).toMatchObject({ discount_cents: 3000 });
    expect(evaluateDiscount({ ...base, kind: 'free_shipping', value: 0, min_qty: null, min_subtotal_cents: 8000 }, { subtotal_cents: 7999, qty: 1 }, 0, now)).toEqual({ ok: false, reason: 'min_subtotal' });
    expect(evaluateDiscount({ ...base, active: 0 }, { subtotal_cents: 1, qty: 9 }, 0, now)).toEqual({ ok: false, reason: 'inactive' });
  });
  it('summarises for the list', () => {
    expect(discountSummary(base, (c) => `$${c / 100}`)).toBe('15% off · 3+ items');
  });
  it('validates codes, percent range and date order', () => {
    expect(discountCreate.parse({ code: 'bundle-2', kind: 'percent', value: 10 }).code).toBe('BUNDLE-2');
    expect(discountCreate.safeParse({ code: 'X', kind: 'percent', value: 10 }).success).toBe(false);
    expect(discountCreate.safeParse({ code: 'BIG', kind: 'percent', value: 101 }).success).toBe(false);
    expect(discountCreate.safeParse({ code: 'LATE', kind: 'fixed', value: 500, starts_at: '2026-10-02', ends_at: '2026-10-01' }).success).toBe(false);
  });
});

describe('schemas for fulfill and assignment', () => {
  it('tracking links must be https', () => {
    expect(orderFulfill.safeParse({ tracking_url: 'http://track.example/1' }).success).toBe(false);
    expect(orderFulfill.parse({ tracking_url: 'https://track.example/1', notify: true }).notify).toBe(1);
  });
  it('design patch needs a status or an assignee', () => {
    expect(designPatch.safeParse({}).success).toBe(false);
    expect(designPatch.parse({ assignee_id: null })).toEqual({ assignee_id: null });
  });
});

describe('metric formatting', () => {
  it('formats money, counts and percents; null is an em dash', () => {
    expect(formatMetric(123456, 'money')).toBe('$1,234.56');
    expect(formatMetric(12345678, 'money', true)).toBe('$123.5K');
    expect(formatMetric(0.2063, 'percent')).toBe('20.6%');
    expect(formatMetric(null, 'count')).toBe('—');
    expect(formatChange(-0.409)).toBe('−40.9%');
    expect(formatChange(null)).toBeNull();
  });
  it('nice axis ticks cover the max with 1/2/2.5/5 steps', () => {
    const r = niceMax(90374, 'money');
    expect(r.top).toBeGreaterThanOrEqual(90374);
    expect(r.ticks[0]).toBe(0);
    expect(r.ticks.at(-1)).toBe(r.top);
    expect(niceMax(3, 'count').ticks.every(Number.isInteger)).toBe(true);
  });
});
