import { describe, expect, it } from 'vitest';
import { breadcrumbJsonLd, ldJson, organizationJsonLd } from './seo';
import { DEFAULTS } from './settings';

describe('seo', () => {
  it('builds absolute breadcrumb items in order', () => {
    const ld = breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Privacy', path: '/policies/privacy' }]);
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'http://localhost:3000/' },
      { '@type': 'ListItem', position: 2, name: 'Privacy', item: 'http://localhost:3000/policies/privacy' },
    ]);
  });
  it('organization comes from settings', () => {
    expect(organizationJsonLd(DEFAULTS)).toMatchObject({ '@type': 'Organization', name: 'Pearl Atelier', email: DEFAULTS.shop.support_email });
  });
  it('escapes < so a value cannot close the script tag', () => {
    expect(ldJson({ name: '</script><script>alert(1)</script>' })).not.toContain('<');
  });
});
