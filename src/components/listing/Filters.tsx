import Link from 'next/link';
import { PRICE_BANDS, tagLabel, type Facet } from '@/lib/listing';
import { UiIcon } from '@/components/nav/icons';
import { listHref, toggle, type UrlState } from './urls';

const chip = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors';
const off = `${chip} border-border bg-card text-foreground hover:border-foreground`;
const on = `${chip} border-accent bg-accent text-on-accent hover:opacity-90`;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-foreground">{title}</legend>
      <ul className="mt-3 flex flex-wrap gap-2">{children}</ul>
    </fieldset>
  );
}

/**
 * Bộ lọc dạng chip-link (không cần JS): mỗi chip là link bật/tắt giá trị đó. rel=nofollow để bot không bò mọi tổ hợp.
 * Giá trị đang chọn nhưng không còn trong facets (vd. vừa đổi collection) vẫn hiện để bỏ được.
 */
export function FilterPanel({ path, state, theme, type }: { path: string; state: UrlState; theme: Facet[]; type: Facet[] }) {
  const withSelected = (facets: Facet[], sel: string[]) => [
    ...facets, ...sel.filter((v) => !facets.some((f) => f.value === v)).map((v) => ({ value: v, label: tagLabel(v), count: 0 })),
  ];
  const opt = (key: 'theme' | 'type', f: Facet) => {
    const active = state[key].includes(f.value);
    return (
      <li key={f.value}>
        <Link href={listHref(path, state, { [key]: toggle(state[key], f.value) })} rel="nofollow" scroll={false} className={active ? on : off}
          aria-label={`${f.label}${f.count ? `, ${f.count} ${f.count === 1 ? 'product' : 'products'}` : ''}${active ? ', selected. Remove filter' : ''}`}>
          {active && <UiIcon name="check" size={16} />}
          {f.label}
          {f.count > 0 && <span className={active ? 'text-on-accent/80' : 'text-muted-foreground'} aria-hidden="true">{f.count}</span>}
        </Link>
      </li>
    );
  };
  const themes = withSelected(theme, state.theme);
  const types = withSelected(type, state.type);
  return (
    <div className="grid gap-6">
      {types.length > 0 && <Group title="Type">{types.map((f) => opt('type', f))}</Group>}
      {themes.length > 0 && <Group title="Theme">{themes.map((f) => opt('theme', f))}</Group>}
      <Group title="Price">
        {PRICE_BANDS.map((b) => {
          const active = state.price === b.id;
          return (
            <li key={b.id}>
              <Link href={listHref(path, state, { price: active ? null : b.id })} rel="nofollow" scroll={false} className={active ? on : off}
                aria-label={`${b.label}${active ? ', selected. Remove filter' : ''}`}>
                {active && <UiIcon name="check" size={16} />}{b.label}
              </Link>
            </li>
          );
        })}
      </Group>
    </div>
  );
}

export const activeCount = (s: UrlState) => s.theme.length + s.type.length + (s.price ? 1 : 0);

/** Hàng chip bộ lọc đang áp dụng, mỗi chip bỏ được, + "Clear all". */
export function ActiveFilters({ path, state }: { path: string; state: UrlState }) {
  if (!activeCount(state)) return null;
  const items = [
    ...state.type.map((v) => ({ key: `type:${v}`, label: tagLabel(v), href: listHref(path, state, { type: toggle(state.type, v) }) })),
    ...state.theme.map((v) => ({ key: `theme:${v}`, label: tagLabel(v), href: listHref(path, state, { theme: toggle(state.theme, v) }) })),
    ...(state.price ? [{ key: 'price', label: PRICE_BANDS.find((b) => b.id === state.price)!.label, href: listHref(path, state, { price: null }) }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only">Active filters:</span>
      {items.map((i) => (
        <Link key={i.key} href={i.href} rel="nofollow" scroll={false} aria-label={`Remove filter: ${i.label}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-muted px-4 text-sm font-medium text-foreground hover:bg-border">
          {i.label}<UiIcon name="x" size={16} />
        </Link>
      ))}
      <Link href={listHref(path, { ...state, theme: [], type: [], price: null })} rel="nofollow" scroll={false}
        className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-foreground underline underline-offset-4 hover:text-accent">
        Clear all
      </Link>
    </div>
  );
}
