// Kiểm tra dữ liệu dùng chung giữa các route designs.
import { z } from 'zod';
import { db } from '../db';
import type { Settings } from '../types';
import { apiError } from './http';
import { TransformSchema } from './render';

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

export const DesignFields = {
  variant_id: z.number().int().positive().nullable().optional(),
  style: z.string().min(1).max(64).nullable().optional(),
  pet_name: text(40),
  notes: text(1000),
  email: z.union([z.literal('').transform(() => null), z.email().max(254)]).nullable().optional(),
  transform: TransformSchema.nullable().optional(),
};

export function checkProductVariant(productId: number, variantId: number | null): Response | null {
  const p = db().prepare("SELECT id FROM products WHERE id = ? AND status = 'active'").get(productId);
  if (!p) return apiError(404, 'product_not_found', 'That product is not available.');
  if (variantId != null) {
    const v = db().prepare('SELECT id FROM variants WHERE id = ? AND product_id = ?').get(variantId, productId);
    if (!v) return apiError(400, 'invalid_variant', 'That size is not available for this product.');
  }
  return null;
}

export function checkStyle(style: string, s: Settings): Response | null {
  return s.ai.styles.some((x) => x.id === style) ? null : apiError(400, 'invalid_style', 'That style is not available.');
}
