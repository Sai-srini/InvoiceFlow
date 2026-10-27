export class AppError extends Error {
  status: number;
  code: string;
  details?: any;
  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg: string, details?: any, code = 'BAD_REQUEST') => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Authentication required.') => new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = 'You do not have permission to do this.', code = 'FORBIDDEN', details?: any) =>
  new AppError(403, code, msg, details);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (msg: string, code = 'CONFLICT', details?: any) => new AppError(409, code, msg, details);
export const notConfigured = (msg: string) => new AppError(501, 'NOT_CONFIGURED', msg);
