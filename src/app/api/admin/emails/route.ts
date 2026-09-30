import { admin } from '@/app/admin/_lib/http';
import { listEmails } from '@/app/admin/_lib/repo';

export const GET = admin(() => Response.json({ emails: listEmails() }));
