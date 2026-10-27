import { Permission } from '../domain/permissions';

export interface Actor {
  orgId: string; userId: string; email: string; name: string;
  permissions: Set<Permission>; user: any; ip?: string; ua?: string;
}
declare global {
  namespace Express { interface Request { actor?: Actor; requestId?: string; } }
}
