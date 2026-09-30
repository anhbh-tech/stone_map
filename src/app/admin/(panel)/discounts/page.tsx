import type { Metadata } from 'next';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import { requireAdminPage } from '../../_lib/session';
import { DISCOUNT_SORTS, DISCOUNT_STATES, STATE_LABEL, discountSummary, searchDiscounts } from '../../_lib/discounts';
import { hrefWith, listState, pick, type SearchParams } from '../../_lib/list';
import { Icon } from '../../_components/icons';
import { CheckoutNote } from '../../_components/checkout-note';
import { EmptyState, FilterBar, PageHeader, Pagination, SortHeader, StatusBadge, Table, Tabs, btn, fmtDay, linkCls, td, th, tr } from '../../_components/ui';

export const metadata: Metadata = { title: 'Discounts' };

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const base = '/admin/discounts';
  const state = pick(sp.state, DISCOUNT_STATES);
  const s = listState(sp, DISCOUNT_SORTS, 'created');
  const { rows, total } = searchDiscounts(s, state);
  const tabs = [
    { href: base, label: 'All', current: !state },
    ...(['active', 'scheduled', 'expired', 'disabled'] as const).map((st) => ({ href: hrefWith(base, {}, { state: st }), label: STATE_LABEL[st], current: state === st })),
  ];
  const sortProps = { sort: s.sort, dir: s.dir, base, sp };
  const add = <Link href="/admin/discounts/new" className={`${btn.base} ${btn.primary}`}><Icon name="plus" /> Create discount</Link>;
  return (
    <>
      <PageHeader title="Discounts" description="Codes customers enter at checkout, including buy-more tiers by number of portraits." actions={add} />
      <CheckoutNote />
      <section aria-label="Discount list" className="rounded-[var(--radius)] border border-border bg-card">
        <Tabs label="Discount status" items={tabs} />
        <FilterBar base={base} q={s.q} sp={sp} placeholder="Search by code" hidden={{ state }} />
        {rows.length === 0 ? (
          <div className="border-t border-border">
            {s.q || state
              ? <EmptyState title="No discounts match" action={<Link href={base} className={`${btn.base} ${btn.outline}`}>Show all discounts</Link>}>Try another code or status.</EmptyState>
              : <EmptyState icon="tag" title="No discount codes yet" action={add}>Create a percentage, fixed-amount or free-shipping code, with an optional minimum and end date.</EmptyState>}
          </div>
        ) : (
          <>
            <div className="border-t border-border">
              <Table caption="Discount codes" minWidth={680}>
                <thead><tr>
                  <SortHeader label="Code" col="code" {...sortProps} />
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Ends</th>
                  <SortHeader label="Used" col="used" align="right" {...sortProps} />
                  <SortHeader label="Created" col="created" {...sortProps} />
                </tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className={tr}>
                      <td className={td}><Link href={`/admin/discounts/${d.id}`} className={`${linkCls} font-mono`}>{d.code}</Link><div className="text-xs text-muted-foreground">{discountSummary(d, fmt)}</div></td>
                      <td className={td}><StatusBadge status={d.state} label={STATE_LABEL[d.state]} /></td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{d.ends_at ? fmtDay(d.ends_at) : 'No end date'}</td>
                      <td className={`${td} text-right`}>{d.used}{d.usage_limit ? <span className="text-muted-foreground"> / {d.usage_limit}</span> : ''}</td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDay(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination page={s.page} per={s.per} total={total} base={base} sp={sp} noun="discounts" />
          </>
        )}
      </section>
    </>
  );
}
