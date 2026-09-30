// Social proof (#4): mọi con số đến từ reviewSummary()/listReviews() — không gõ tay, không tên nền tảng review bên ngoài.
import Image from 'next/image';
import type { Review, ReviewSummary } from '@/lib/reviews';
import { BadgeCheckIcon, FlaskIcon, StarIcon } from './icons';

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex text-foreground" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="relative inline-block" style={{ width: size, height: size }}>
          <StarIcon size={size} filled={false} className="absolute inset-0" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, value - n + 1)) * 100}%` }}>
            <StarIcon size={size} className="max-w-none" />
          </span>
        </span>
      ))}
    </span>
  );
}

// SQLite datetime('now') là UTC không có hậu tố; chuỗi ISO đầy đủ giữ nguyên.
function fmtDate(f: Intl.DateTimeFormat, s: string) {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : f.format(d);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Dòng ngắn cạnh tiêu đề, link xuống khối review. Không có review → không hiện gì. */
export function RatingLink({ summary }: { summary: ReviewSummary }) {
  if (!summary.count || summary.average == null) return null;
  return (
    <a href="#reviews" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline">
      <Stars value={summary.average} />
      <span>
        <span className="sr-only">Rated {summary.average} out of 5, </span>
        {summary.average.toFixed(1)} · {plural(summary.count, 'review')}
        {summary.has_samples && <span> (includes sample reviews)</span>}
      </span>
    </a>
  );
}

export function Reviews({ summary, reviews }: { summary: ReviewSummary; reviews: Review[] }) {
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <section id="reviews" aria-labelledby="reviews-title" className="scroll-mt-20 border-t border-border pt-10">
      <h2 id="reviews-title" className="text-3xl font-semibold">Customer reviews</h2>
      {!summary.count || summary.average == null ? (
        <p className="mt-3 text-muted-foreground">No reviews yet. Reviews appear here after customers receive their portraits.</p>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div>
            <p className="flex items-baseline gap-2">
              <span className="font-serif text-5xl font-semibold">{summary.average.toFixed(1)}</span>
              <span className="text-muted-foreground">out of 5</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Stars value={summary.average} size={20} />
              <span className="text-sm text-muted-foreground">{plural(summary.count, 'review')}</span>
            </div>
            <ul className="mt-5 space-y-2" aria-label="Rating breakdown">
              {([5, 4, 3, 2, 1] as const).map((n) => {
                const c = summary.histogram[n];
                return (
                  <li key={n} className="grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
                    <span>{n} star{n === 1 ? '' : 's'}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-foreground" style={{ width: `${(c / summary.count) * 100}%` }} />
                    </span>
                    <span className="text-right text-muted-foreground"><span className="sr-only">{n} stars: </span>{c}</span>
                  </li>
                );
              })}
            </ul>
            {summary.has_samples && (
              <p className="mt-5 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
                Some reviews shown are sample content for this demo store. They are labelled and are not counted as real customer feedback in search results.
              </p>
            )}
          </div>
          <ul className="gap-4 sm:columns-2" aria-label="Reviews">
            {reviews.map((r) => (
              <li key={r.id} className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
                {r.photo_url && (
                  <div className="relative aspect-[4/3] bg-muted">
                    <Image src={r.photo_url} alt={`Photo from ${r.author}'s review`} fill sizes="(min-width: 640px) 33vw, 100vw" className="object-cover" unoptimized={!r.photo_url.startsWith('/demo/')} />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={r.rating} />
                    <span className="sr-only">{r.rating} out of 5 stars</span>
                    {r.is_sample && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                        <FlaskIcon size={14} /> Sample review
                      </span>
                    )}
                    {r.verified && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-success">
                        <BadgeCheckIcon size={14} /> Verified buyer
                      </span>
                    )}
                  </div>
                  {r.title && <h3 className="text-xl font-semibold">{r.title}</h3>}
                  <p className="text-sm">{r.body}</p>
                  <p className="mt-auto pt-2 text-sm text-muted-foreground">
                    {r.author} · <time dateTime={r.created_at}>{fmtDate(date, r.created_at)}</time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
