"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllJobs = registerAllJobs;
const queues_1 = require("../queues");
const intake_service_1 = require("../services/intake.service");
const reconciliation_service_1 = require("../services/reconciliation.service");
const approval_service_1 = require("../services/approval.service");
const notification_service_1 = require("../services/notification.service");
let done = false;
function registerAllJobs() {
    if (done)
        return;
    done = true;
    (0, queues_1.registerJob)('intake.extract', (d) => (0, intake_service_1.extractDocument)(d.orgId, d.id));
    (0, queues_1.registerJob)('recon.match', (d) => (0, reconciliation_service_1.runMatching)(d.orgId, d.userId || null, d.importId));
    (0, queues_1.registerJob)('approvals.escalate', () => (0, approval_service_1.escalateOverdueSteps)());
    (0, queues_1.registerJob)('notifications.email', () => (0, notification_service_1.dispatchPendingEmails)());
}
//# sourceMappingURL=index.js.map