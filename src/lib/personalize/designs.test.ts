import { describe, expect, it } from 'vitest';
import type { DesignStatus } from '../types';
import { editableFields, nextStatus, type DesignEvent } from './designs';

const ALL_STATUSES: DesignStatus[] = ['draft', 'generating', 'ready', 'failed', 'confirmed', 'in_review', 'approved', 'rejected'];
const ALL_EVENTS: DesignEvent[] = ['generate', 'job_succeeded', 'job_failed', 'confirm', 'submit', 'approve', 'reject'];

describe('design status machine', () => {
  it('ai happy path: draft → generating → ready → confirmed', () => {
    expect(nextStatus('ai', 'draft', 'generate')).toBe('generating');
    expect(nextStatus('ai', 'generating', 'job_succeeded')).toBe('ready');
    expect(nextStatus('ai', 'ready', 'confirm')).toBe('confirmed');
  });
  it('ai: failed or ready can be regenerated; generating cannot be confirmed', () => {
    expect(nextStatus('ai', 'generating', 'job_failed')).toBe('failed');
    expect(nextStatus('ai', 'failed', 'generate')).toBe('generating');
    expect(nextStatus('ai', 'ready', 'generate')).toBe('generating');
    expect(nextStatus('ai', 'generating', 'confirm')).toBeNull();
    expect(nextStatus('ai', 'draft', 'confirm')).toBeNull();
    expect(nextStatus('ai', 'failed', 'confirm')).toBeNull();
  });
  it('confirmed is final for the customer', () => {
    for (const ev of ALL_EVENTS) expect(nextStatus('ai', 'confirmed', ev)).toBeNull();
  });
  it('designer path: draft → in_review → approved | rejected → in_review', () => {
    expect(nextStatus('designer', 'draft', 'submit')).toBe('in_review');
    expect(nextStatus('designer', 'in_review', 'approve')).toBe('approved');
    expect(nextStatus('designer', 'in_review', 'reject')).toBe('rejected');
    expect(nextStatus('designer', 'rejected', 'submit')).toBe('in_review');
    expect(nextStatus('designer', 'draft', 'generate')).toBeNull();
    expect(nextStatus('ai', 'draft', 'submit')).toBeNull();
  });
  it('every transition lands on a valid status', () => {
    for (const mode of ['ai', 'designer'] as const) for (const s of ALL_STATUSES) for (const ev of ALL_EVENTS) {
      const to = nextStatus(mode, s, ev);
      if (to) expect(ALL_STATUSES).toContain(to);
    }
  });
  it('locks the image once confirmed, but size and contact can still change', () => {
    expect(editableFields('confirmed')).not.toContain('transform');
    expect(editableFields('confirmed')).not.toContain('style');
    expect(editableFields('confirmed')).toContain('variant_id');
    expect(editableFields('approved')).toEqual([]);
    expect(editableFields('generating')).toContain('email');
  });
});
