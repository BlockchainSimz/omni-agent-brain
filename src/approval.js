import crypto from 'node:crypto';

export class ApprovalService {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, requiredApprovals = 1, clock = () => Date.now() } = {}) {
    if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1) throw new Error('invalid_required_approvals');
    this.ttlMs = ttlMs;
    this.requiredApprovals = requiredApprovals;
    this.clock = clock;
    this.requests = new Map();
  }

  request({ action, target, reason = '', requester = 'system' }) {
    if (!action || !target) throw new Error('approval_action_and_target_required');
    const id = crypto.randomUUID();
    const record = { id, action, target, reason, requester, status: 'pending', approvals: [], createdAt: this.clock(), expiresAt: this.clock() + this.ttlMs };
    this.requests.set(id, record);
    return this.view(record);
  }

  approve(id, approver) {
    const record = this.get(id);
    if (record.status !== 'pending') throw new Error('approval_not_pending');
    if (!approver) throw new Error('approval_actor_required');
    if (!record.approvals.includes(approver)) record.approvals.push(approver);
    if (record.approvals.length >= this.requiredApprovals) record.status = 'approved';
    return this.view(record);
  }

  reject(id, reason = '') {
    const record = this.get(id);
    if (record.status !== 'pending') throw new Error('approval_not_pending');
    record.status = 'rejected';
    record.rejectionReason = reason;
    return this.view(record);
  }

  consume(id) {
    const record = this.get(id);
    if (record.status !== 'approved') throw new Error('approval_required');
    record.status = 'consumed';
    return this.view(record);
  }

  get(id) {
    const record = this.requests.get(id);
    if (!record) throw new Error('approval_not_found');
    if (record.status === 'pending' && record.expiresAt <= this.clock()) {
      record.status = 'expired';
    }
    return record;
  }

  list() {
    return [...this.requests.values()].map(record => this.view(record));
  }

  view(record) {
    return { ...record, approvals: [...record.approvals] };
  }
}
