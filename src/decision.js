import crypto from 'node:crypto';

export class DecisionEngine {
  constructor({ policy, execution, audit, minConfidence = 0.7 } = {}) {
    if (!policy || !execution) throw new Error('policy and execution are required');
    this.policy = policy;
    this.execution = execution;
    this.audit = audit || (() => {});
    this.minConfidence = minConfidence;
  }

  propose(input = {}) {
    const id = crypto.randomUUID();
    const confidence = Number(input.confidence ?? 0);
    if (!input.capability) throw new Error('capability is required');
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence must be between 0 and 1');
    const proposal = Object.freeze({ id, capability: input.capability, input: input.input ?? {}, confidence, rationale: input.rationale || '', evidence: input.evidence || [], status: confidence >= this.minConfidence ? 'pending_policy' : 'rejected_low_confidence', createdAt: new Date().toISOString() });
    this.audit({ type: 'decision.proposed', decisionId: id, capability: proposal.capability, status: proposal.status, confidence });
    return proposal;
  }

  async execute(proposal) {
    if (!proposal || proposal.status !== 'pending_policy') throw new Error('proposal is not executable');
    const rule = this.policy.authorize(proposal.capability, proposal.input);
    if (rule.approvalRequired) throw new Error('explicit approval required');
    const result = await this.execution.execute(proposal.capability, proposal.input);
    this.audit({ type: 'decision.completed', decisionId: proposal.id, capability: proposal.capability, ok: result.ok, executionId: result.executionId });
    return { proposal, result };
  }
}
