import { registerJob } from '../queues';
import { extractDocument } from '../services/intake.service';
import { runMatching } from '../services/reconciliation.service';
import { escalateOverdueSteps } from '../services/approval.service';
import { dispatchPendingEmails } from '../services/notification.service';

let done = false;
export function registerAllJobs() {
  if (done) return; done = true;
  registerJob('intake.extract', (d) => extractDocument(d.orgId, d.id));
  registerJob('recon.match', (d) => runMatching(d.orgId, d.userId || null, d.importId));
  registerJob('approvals.escalate', () => escalateOverdueSteps());
  registerJob('notifications.email', () => dispatchPendingEmails());
}
