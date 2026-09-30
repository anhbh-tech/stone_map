'use client';
// STUB của UI-1 theo hợp đồng chung: crew UI-2 sở hữu file này (gợi ý từ GET /api/search/suggest). Khi rebase, bản của UI-2 thắng.
import { Icon } from '../shell/Icon';

export function SearchBox({ variant = 'header', defaultQuery }: { variant?: 'header' | 'page'; defaultQuery?: string }) {
  return (
    <form role="search" action="/search" method="get" className={`relative w-full ${variant === 'page' ? 'max-w-2xl' : ''}`}>
      <label htmlFor={`search-${variant}`} className="sr-only">Search products</label>
      <input
        id={`search-${variant}`} type="search" name="q" defaultValue={defaultQuery} placeholder="Search pet portraits"
        autoComplete="off" enterKeyHint="search"
        className="h-11 w-full rounded-full border border-input bg-background pl-4 pr-12 text-base text-foreground placeholder:text-muted-foreground"
      />
      <button type="submit" aria-label="Search" className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted">
        <Icon name="search" />
      </button>
    </form>
  );
}
