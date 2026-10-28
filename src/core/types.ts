/** Account reference: a Jira or Bitbucket account ID, or a demo identity such as `u:lea`. */
export type Ref = string;

export type Kind = 'human' | 'agent' | 'service' | 'automation';

export interface Person {
  name: string;
  kind: Kind;
  /** For a service account that opens pull requests on behalf of an agent. */
  actsAs?: Ref;
}

export interface Assignment {
  at: string;
  by: Ref;
  to: Ref;
  via?: { automationRule: string };
}

/** Recorded by the MCP tool `declare_agent_work`. `principal` comes from the call's identity. */
export interface Declaration {
  at: string;
  principal: Ref;
  branch?: string;
  agentLabel?: string;
}

export interface Commit {
  hash: string;
  author: Ref;
  at: string;
  message?: string;
}

export type ReviewAction = 'approved' | 'unapproved' | 'changes_requested';

export interface Review {
  by: Ref;
  action: ReviewAction;
  at: string;
  /** Head commit of the pull request when the review was given. */
  commit: string;
}

export interface Comment {
  by: Ref;
  at: string;
  text: string;
}

export type PullRequestState = 'OPEN' | 'MERGED' | 'DECLINED';

export interface PullRequest {
  id: string;
  repo: string;
  title?: string;
  description?: string;
  url?: string;
  author: Ref;
  sourceBranch: string;
  state: PullRequestState;
  createdAt: string;
  mergedAt?: string;
  mergedBy?: Ref;
  mergeCommit?: string;
  /** In push order; the last one is the head. */
  commits: Commit[];
  reviews: Review[];
  comments?: Comment[];
}

export interface Deployment {
  id: string;
  env: string;
  at: string;
  commit: string;
  triggeredBy?: Ref;
  url?: string;
  pipeline?: string;
}

export type HistoryState = 'complete' | 'missing';

export interface ChangeChain {
  workItem: { key: string; requester: Ref | null; summary?: string };
  people: Record<Ref, Person>;
  assignments: Assignment[];
  declarations: Declaration[];
  automationRules: Record<string, { owner: Ref | null }>;
  pullRequests: PullRequest[];
  deployments: Deployment[];
  emergency?: { declaredAt: string; declaredBy: Ref } | null;
  history: { jira: HistoryState; scm: HistoryState };
}

export interface Policy {
  version: string;
  emergencyWindowHours: number;
  productionEnvironments: string[];
}

export type VerdictValue = 'PASS' | 'FAIL' | 'CANNOT_DETERMINE';

export type RuleId = 'AL-1' | 'AL-2' | 'AL-3' | 'AL-4' | 'AL-5' | 'AL-6' | 'AL-7' | 'AL-8';

export type Flag = 'RETRO_APPROVAL';

export type Role = 'requester' | 'implementer' | 'principal';

export interface Finding {
  rule: RuleId;
  outcome: 'FAIL' | 'CANNOT_DETERMINE';
  pr?: string;
  deployment?: string;
  people?: Ref[];
  message: string;
}

export interface ConflictedPerson {
  ref: Ref;
  roles: Role[];
  /** Agents this person directed in the change, when they are a principal. */
  directed: Ref[];
}

export type IgnoredReason = 'non_human' | 'conflicted' | 'stale' | 'after_merge';

export interface PrAssessment {
  pr: string;
  repo: string;
  state: PullRequestState;
  verdict: VerdictValue;
  rule: RuleId | null;
  head: string | null;
  agents: Ref[];
  principals: Record<Ref, Ref[]>;
  conflicted: ConflictedPerson[];
  counted: { ref: Ref; at: string; retro: boolean }[];
  ignored: { ref: Ref; at: string; reason: IgnoredReason }[];
  findings: Finding[];
  flags: Flag[];
}

export interface DeploymentAssessment {
  id: string;
  env: string;
  at: string;
  commit: string;
  pr: string | null;
  verdict: VerdictValue;
  rule: RuleId | null;
}

export interface Verdict {
  workItem: string;
  verdict: VerdictValue;
  rule: RuleId | null;
  flags: Flag[];
  findings: Finding[];
  pullRequests: PrAssessment[];
  deployments: DeploymentAssessment[];
  rulesVersion: string;
  policyVersion: string;
  evidenceHash: string;
}
