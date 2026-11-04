"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVOICE_ACTIONS = exports.INVOICE_STATUSES = void 0;
exports.nextStatus = nextStatus;
exports.assertTransition = assertTransition;
exports.INVOICE_STATUSES = ['draft', 'in_review', 'approved', 'rejected', 'on_hold', 'scheduled', 'released', 'paid', 'reconciled'];
/** Every legal action and the status it moves an invoice between. There is no generic "set status". */
exports.INVOICE_ACTIONS = {
    submit: { from: ['draft'], to: 'in_review' },
    approve: { from: ['in_review'], to: 'approved' }, // only when every approval step is approved
    reject: { from: ['in_review'], to: 'rejected' },
    hold: { from: ['in_review'], to: 'on_hold' },
    resume: { from: ['on_hold'], to: 'in_review' },
    reopen: { from: ['rejected'], to: 'draft' },
    schedule: { from: ['approved'], to: 'scheduled' }, // included in a payment run
    unschedule: { from: ['scheduled'], to: 'approved' }, // run cancelled / payment removed
    release: { from: ['scheduled'], to: 'released' }, // run released, file generated
    paid: { from: ['released'], to: 'paid' }, // bank-confirmed
    fail: { from: ['released'], to: 'approved' }, // payment failed or returned: back to approved
    reconcile: { from: ['paid'], to: 'reconciled' },
};
function nextStatus(from, action) {
    const a = exports.INVOICE_ACTIONS[action];
    return a.from.includes(from) ? a.to : null;
}
function assertTransition(from, action) {
    const to = nextStatus(from, action);
    if (!to)
        throw new Error(`Cannot ${action} an invoice that is ${from}.`);
    return to;
}
//# sourceMappingURL=stateMachine.js.map