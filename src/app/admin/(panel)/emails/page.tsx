import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminPage } from '../../_lib/session';
import { getEmail, listEmails } from '../../_lib/repo';
import { Card, Empty, PageHeader, StatusBadge, fmtDate } from '../../_components/ui';

export const metadata: Metadata = { title: 'Email outbox' };

// Mailer giả lập: mọi email gửi khách nằm ở bảng email_outbox. HTML hiện trong iframe sandbox (không chạy script).
export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireAdminPage();
  const emails = listEmails();
  const id = Number((await searchParams).id);
  const open = Number.isInteger(id) && id > 0 ? getEmail(id) : emails[0] ? getEmail(emails[0].id) : undefined;
  return (
    <>
      <PageHeader title="Email outbox" description="Every email the store would send. Nothing leaves the server in this environment." />
      {emails.length === 0 ? <Empty>No emails yet.</Empty> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card>
            <ul className="-my-2 divide-y divide-border">
              {emails.map((e) => (
                <li key={e.id}>
                  <Link href={`/admin/emails?id=${e.id}`} aria-current={open?.id === e.id ? 'true' : undefined}
                    className={`block rounded-[var(--radius)] px-2 py-3 ${open?.id === e.id ? 'bg-muted' : 'hover:bg-muted'}`}>
                    <span className="block font-medium">{e.subject}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge status={e.kind} tone="info" /> {e.to_addr} · {fmtDate(e.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {open && (
            <Card title={open.subject} id="email-view" description={<>To {open.to_addr} · {fmtDate(open.created_at)}</>}>
              <iframe title={`Email: ${open.subject}`} srcDoc={open.html} sandbox="" className="h-[60vh] min-h-80 w-full rounded-[var(--radius)] border border-border bg-card" />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
