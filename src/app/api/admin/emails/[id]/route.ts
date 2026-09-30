import { admin, intId, notFound } from '@/app/admin/_lib/http';
import { getEmail } from '@/app/admin/_lib/repo';

export const GET = admin<{ id: string }>((_req, { id }) => Response.json(getEmail(intId(id)) ?? notFound('Email')));
