import type { Policy, RuleId } from './types';

export const RULES_VERSION = '2026.10.1';

export const DEFAULT_POLICY: Policy = {
  version: 'independence-v1',
  emergencyWindowHours: 72,
  productionEnvironments: ['production'],
};

export interface Reference {
  source: string;
  clause: string;
  quote: string;
}

export interface Rule {
  id: RuleId;
  title: string;
  outcome: 'FAIL' | 'CANNOT_DETERMINE';
  statement: string;
  references: Reference[];
}

const DORA_RTS = 'Commission Delegated Regulation (EU) 2024/1774 (DORA RTS on ICT risk management)';
const DORA = 'Regulation (EU) 2022/2554 (DORA)';
const PCI = 'PCI DSS v4.0.1';

const INDEPENDENCE: Reference = {
  source: DORA_RTS,
  clause: 'Article 17, ICT change management',
  quote: 'mechanisms to ensure the independence of the functions that approve changes',
};
const OTHER_THAN_AUTHOR: Reference = {
  source: PCI,
  clause: 'Requirement 6.2.3.1',
  quote: 'Reviewed by individuals other than the originating code author',
};
const APPROVED_BEFORE_RELEASE: Reference = {
  source: PCI,
  clause: 'Requirement 6.2.3.1',
  quote: 'Reviewed and approved by management prior to release',
};
const ONLY_APPROVED_DEPLOYED: Reference = {
  source: PCI,
  clause: 'Requirement 6.5.4',
  quote: 'only reviewed and approved changes are deployed',
};
const DOCUMENTED_CONTROLS: Reference = {
  source: DORA,
  clause: 'Article 9(4)(e)',
  quote: 'implement documented policies, procedures and controls for ICT change management',
};
const EMERGENCY: Reference = {
  source: DORA_RTS,
  clause: 'Article 17, ICT change management',
  quote: 'procedures, protocols, and tools to manage emergency changes that provide adequate safeguards',
};

/** The versioned rule table. Every verdict names one of these rules. */
export const RULES: Record<RuleId, Rule> = {
  'AL-1': {
    id: 'AL-1',
    title: 'Independent approval',
    outcome: 'FAIL',
    statement:
      'Each pull request needs an approval from a person who did not request the change, write it, or direct an agent that wrote it.',
    references: [INDEPENDENCE, OTHER_THAN_AUTHOR],
  },
  'AL-2': {
    id: 'AL-2',
    title: 'Approval covers the final commit',
    outcome: 'FAIL',
    statement: 'An approval counts only for the commit it was given on. Commits pushed after it need a new approval.',
    references: [APPROVED_BEFORE_RELEASE, ONLY_APPROVED_DEPLOYED],
  },
  'AL-3': {
    id: 'AL-3',
    title: 'Approvers are people',
    outcome: 'FAIL',
    statement: 'Approvals from agents, service accounts and automation do not count as independent approval.',
    references: [INDEPENDENCE, OTHER_THAN_AUTHOR],
  },
  'AL-4': {
    id: 'AL-4',
    title: 'Agent work has a known principal',
    outcome: 'CANNOT_DETERMINE',
    statement:
      'When an agent or service account wrote part of the change, the person who directed it must be known, through an assignment, an automation rule owner or an MCP declaration.',
    references: [INDEPENDENCE],
  },
  'AL-5': {
    id: 'AL-5',
    title: 'Complete history',
    outcome: 'CANNOT_DETERMINE',
    statement: 'The Jira history and the repository history the verdict needs must be available.',
    references: [DOCUMENTED_CONTROLS],
  },
  'AL-6': {
    id: 'AL-6',
    title: 'Approval before the merge',
    outcome: 'FAIL',
    statement:
      'The independent approval must precede the merge. A declared emergency change may be approved afterwards, within the policy window.',
    references: [APPROVED_BEFORE_RELEASE, EMERGENCY],
  },
  'AL-7': {
    id: 'AL-7',
    title: 'Production traces to an approved change',
    outcome: 'FAIL',
    statement: 'Every production deployment of the work item must run a commit of one of its merged pull requests.',
    references: [ONLY_APPROVED_DEPLOYED],
  },
  'AL-8': {
    id: 'AL-8',
    title: 'Linked change evidence',
    outcome: 'CANNOT_DETERMINE',
    statement: 'A work item released to production needs at least one linked pull request.',
    references: [DOCUMENTED_CONTROLS],
  },
};

/** Order in which the primary rule of a verdict is chosen, most specific first. */
export const FAIL_PRECEDENCE: RuleId[] = ['AL-7', 'AL-6', 'AL-2', 'AL-3', 'AL-1'];
export const UNKNOWN_PRECEDENCE: RuleId[] = ['AL-5', 'AL-4', 'AL-8'];
