// Forge entry points of the Jira, Confluence and Rovo app. Handlers are referenced from manifest.yml.
export { handler as resolver } from './forge/resolvers';
export { handler as evidence } from './forge/webtrigger';
export { validate } from './forge/validator';
export {
  declareAgentWorkAction as declareAgentWork,
  whoMustApproveAction as whoMustApprove,
  changeEvidenceAction as changeEvidence,
  populationTestAction as populationTest,
  managementResponseAction as managementResponse,
} from './forge/actions';
export { onIssueUpdated } from './forge/events';
