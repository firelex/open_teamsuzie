import type { AllowRule, CapRule, SendRule } from './config.js';

export interface PolicyInput {
    kind: 'send' | 'reply';
    agentId: string;
    /** Every To, Cc and Bcc address, lowercased. */
    recipients: string[];
    /** The people already in the conversation being replied to, or null when not known. */
    threadParticipants: string[] | null;
    /** How many sends this agent made in the last hour without human approval. */
    autoSentLastHour: number;
}

export type PolicyDecision = { allowed: true; rule: number } | { allowed: false; reason: string };

function isCap(rule: SendRule): rule is CapRule {
    return 'max_per_hour' in rule;
}

function appliesTo(rule: SendRule, agentId: string): boolean {
    return rule.agents.includes('*') || rule.agents.includes(agentId);
}

function domainOf(address: string): string {
    return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

function inDomains(address: string, domains: string[]): boolean {
    const domain = domainOf(address);
    return domains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`));
}

function allowRuleMatches(rule: AllowRule, input: PolicyInput): boolean {
    if (!rule.allow.includes(input.kind)) return false;
    if (rule.all_recipients_in_domains !== undefined) {
        if (!input.recipients.every((r) => inDomains(r, rule.all_recipients_in_domains!))) return false;
    }
    if (rule.recipients_already_in_thread === true) {
        if (input.threadParticipants === null) return false;
        const participants = new Set(input.threadParticipants.map((p) => p.toLowerCase()));
        if (!input.recipients.every((r) => participants.has(r))) return false;
    }
    return true;
}

/**
 * Whether a send may go out without a person approving it. Only an allow rule that names the agent (or `*`), the
 * kind of send, and whose every condition holds for every recipient allows it; a cap rule the agent has reached
 * stops it. Anything else needs approval.
 */
export function evaluateSendPolicy(rules: SendRule[], input: PolicyInput): PolicyDecision {
    for (const rule of rules) {
        if (isCap(rule) && appliesTo(rule, input.agentId) && input.autoSentLastHour >= rule.max_per_hour) {
            return { allowed: false, reason: `${input.agentId} has already sent ${input.autoSentLastHour} messages without approval in the last hour (limit ${rule.max_per_hour})` };
        }
    }
    if (input.recipients.length === 0) return { allowed: false, reason: 'the recipients are not known' };
    for (const [index, rule] of rules.entries()) {
        if (!isCap(rule) && appliesTo(rule, input.agentId) && allowRuleMatches(rule, input)) return { allowed: true, rule: index };
    }
    return { allowed: false, reason: `no send rule lets ${input.agentId} ${input.kind} to ${input.recipients.join(', ')} without approval` };
}
