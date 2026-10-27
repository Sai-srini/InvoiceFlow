import { Request } from 'express';
export function pageParams(req: Request, defLimit = 25, maxLimit = 100) {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(req.query.limit || defLimit), 10) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
}
export async function paginate(query: any, countQuery: any, req: Request) {
  const { page, limit, skip } = pageParams(req);
  const [data, total] = await Promise.all([query.skip(skip).limit(limit).lean(), countQuery]);
  return { data, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}
