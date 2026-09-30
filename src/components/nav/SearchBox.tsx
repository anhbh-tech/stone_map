'use client';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { UiIcon } from './icons';

// Ô tìm kiếm có gợi ý khi gõ (hợp đồng chung: UI-1 đặt vào header, UI-2 dùng trên /search).
// Mẫu ARIA combobox 1.2: input role=combobox + listbox, di chuyển bằng ↑/↓ qua aria-activedescendant,
// Enter mở gợi ý đang chọn hoặc tìm cả cụm, Esc đóng (Esc lần nữa xoá chữ). Không JS → form GET /search vẫn chạy.
type Item = { handle: string; title: string; image: string | null };

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

/** Bôi đậm các đầu từ khớp với chữ khách gõ (không dùng dangerouslySetInnerHTML). */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return <>{text}</>;
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) => {
        const w = words.find((x) => part.toLowerCase().startsWith(x));
        return w ? <span key={i}><mark className="bg-transparent font-semibold text-foreground">{part.slice(0, w.length)}</mark>{part.slice(w.length)}</span> : <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function SearchBox({ variant = 'header', defaultQuery = '' }: { variant?: 'header' | 'page'; defaultQuery?: string }) {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState(defaultQuery);
  // Kết quả gần nhất và cụm từ của nó: gõ tiếp thì vẫn hiện gợi ý cũ cho tới khi có gợi ý mới (không nhấp nháy).
  const [result, setResult] = useState<{ key: string; items: Item[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const cache = useRef(new Map<string, Item[]>());
  const inputRef = useRef<HTMLInputElement>(null);
  const term = q.trim();
  const ready = term.length >= MIN_CHARS;
  const key = term.toLowerCase();
  const loading = ready && result?.key !== key;

  useEffect(() => {
    if (!ready) return;
    const hit = cache.current.get(key);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      if (hit) { setResult({ key, items: hit }); return; }
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { items: Item[] };
        cache.current.set(key, data.items);
        setResult({ key, items: data.items });
        // Khách đã bấm ↓ trên danh sách cũ: giữ vị trí, chỉ kẹp vào danh sách mới (dòng cuối = "Search for …").
        setActive((a) => Math.min(a, data.items.length));
      } catch {
        // Bị huỷ vì khách gõ tiếp: bỏ qua. Mạng lỗi: coi như không có gợi ý, Enter vẫn tìm được.
        if (!ctrl.signal.aborted) setResult({ key, items: [] });
      }
    }, hit ? 0 : DEBOUNCE_MS);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [term, key, ready]);

  // Gợi ý + một dòng cuối "Search for …" (luôn có khi đủ chữ).
  const shown = ready ? result?.items ?? [] : [];
  const total = ready ? shown.length + 1 : 0;
  const expanded = open && ready;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const go = (i: number) => {
    setOpen(false);
    if (i >= 0 && i < shown.length) router.push(`/products/${shown[i].handle}`);
    else if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && total) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % total); }
    else if (e.key === 'ArrowUp' && total) { e.preventDefault(); setOpen(true); setActive((a) => (a <= 0 ? total - 1 : a - 1)); }
    else if (e.key === 'Escape') {
      if (expanded) { e.preventDefault(); setOpen(false); setActive(-1); } else if (q) { e.preventDefault(); setQ(''); }
    } else if (e.key === 'Enter' && expanded && active >= 0) { e.preventDefault(); go(active); }
  };

  const big = variant === 'page';
  return (
    <form role="search" action="/search" method="get" className={`relative w-full ${big ? '' : 'max-w-md'}`}
      onSubmit={(e) => { e.preventDefault(); if (term) go(-1); else inputRef.current?.focus(); }}>
      <label htmlFor={`${uid}-q`} className="sr-only">Search products</label>
      <div className={`flex items-center rounded-md border border-border bg-card focus-within:border-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${big ? 'h-14' : 'h-11'}`}>
        <UiIcon name="search" size={big ? 22 : 18} className="ml-3 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef} id={`${uid}-q`} name="q" type="search" value={q} maxLength={100}
          role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
          placeholder="Search portraits, kits, gifts"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={`h-full min-w-0 flex-1 bg-transparent px-3 text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${big ? 'text-lg' : 'text-base'}`}
        />
        {loading && <UiIcon name="loader" size={18} className="mr-1 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />}
        {q && (
          <button type="button" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setQ(''); inputRef.current?.focus(); }}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
            <UiIcon name="x" size={18} />
          </button>
        )}
        {big && (
          <button type="submit" className="mr-1.5 inline-flex h-11 shrink-0 items-center rounded-md bg-primary px-5 font-semibold text-on-primary hover:opacity-90">
            Search
          </button>
        )}
      </div>

      <ul id={listId} role="listbox" aria-label="Suggestions" hidden={!expanded}
        onMouseDown={(e) => e.preventDefault() /* giữ focus trong input để click chọn được */}
        className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70vh,28rem)] overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-1.5 shadow-lg shadow-foreground/10">
        {shown.map((it, i) => (
          <li key={it.handle} id={optionId(i)} role="option" aria-selected={active === i} onClick={() => go(i)} onMouseMove={() => setActive(i)}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground ${active === i ? 'bg-muted' : ''}`}>
            {it.image
              ? <Image src={it.image} alt="" width={44} height={44} className="size-11 shrink-0 rounded-md border border-border bg-muted object-cover" />
              : <span className="size-11 shrink-0 rounded-md bg-muted" />}
            <span className="min-w-0 flex-1 truncate"><Highlight text={it.title} query={term} /></span>
          </li>
        ))}
        {ready && !loading && shown.length === 0 && (
          <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">No quick matches. Press Enter to search everything.</li>
        )}
        {ready && (
          <li id={optionId(shown.length)} role="option" aria-selected={active === shown.length} onClick={() => go(-1)} onMouseMove={() => setActive(shown.length)}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground ${active === shown.length ? 'bg-muted' : ''}`}>
            <UiIcon name="search" size={16} className="text-muted-foreground" />
            <span className="truncate">Search for “{term}”</span>
          </li>
        )}
      </ul>
      <p className="sr-only" aria-live="polite">{expanded && !loading ? `${shown.length} ${shown.length === 1 ? 'suggestion' : 'suggestions'} available.` : ''}</p>
    </form>
  );
}
