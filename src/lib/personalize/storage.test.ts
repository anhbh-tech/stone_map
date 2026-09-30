import { describe, expect, it } from 'vitest';
import { mediaUrl, resolveMedia } from './storage';

describe('media allowlist', () => {
  it('serves uploads, previews, mockups and designer artwork previews', () => {
    expect(mediaUrl('uploads/up_a.jpg')).toBe('/media/uploads/up_a.jpg');
    expect(mediaUrl('storage/previews/DSN-AB12CD-k3.webp')).toBe('/media/previews/DSN-AB12CD-k3.webp');
    expect(mediaUrl('storage/designs/DSN-AB12CD/artwork-1790000000000-preview.webp')).toBe('/media/designs/DSN-AB12CD/artwork-1790000000000-preview.webp');
    expect(resolveMedia(['designs', 'DSN-AB12CD', 'artwork-1790000000000-preview.webp'])).not.toBeNull();
    expect(resolveMedia(['mockups', 'DSN-AB12CD-k3.webp'])).not.toBeNull();
  });
  it('never serves print files, generated sources or the database', () => {
    for (const rel of ['print/DSN-AB12CD-k3.png', 'generated/DSN-AB12CD-k3.png', 'storage/designs/DSN-AB12CD/artwork-1790000000000.png', 'store.db', 'uploads/../store.db']) {
      expect(mediaUrl(rel), rel).toBeNull();
    }
    for (const segs of [['print', 'x.png'], ['designs', 'DSN-AB12CD', 'artwork-1.png'], ['store.db'], ['uploads', '..', 'store.db'], ['uploads', '../store.db'], ['storage', 'uploads', 'up_a.jpg'], ['designs', '..', 'print', 'x-preview.webp']]) {
      expect(resolveMedia(segs), segs.join('/')).toBeNull();
    }
  });
});
