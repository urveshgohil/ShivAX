import type { WorkflowErrorCode } from './types.js';
const messages: Record<WorkflowErrorCode, string> = {
    'invalid-options': 'Invalid workflow options.',
    'invalid-plan': 'Invalid tool-call proposal.',
    'missing-capability': 'No workflow tool provides this capability.',
    'capability-denied': 'Workflow capability is not allowed.',
    'registry-changed': 'Workflow tool registration changed.',
    'max-steps': 'Workflow step limit exceeded.',
    'tool-limit': 'Workflow tool call limit exceeded.',
    'model-budget': 'Workflow model budget exceeded.',
    'output-limit': 'Workflow output limit exceeded.',
    timeout: 'Workflow deadline exceeded.',
    cancelled: 'Workflow cancelled.',
    'security-denied': 'Workflow authorization denied.',
    'tool-failed': 'Workflow tool failed.',
    busy: 'Workflow engine is occupied.',
    disposed: 'Workflow engine is disposed.',
    'invalid-state': 'Workflow is not paused.',
};
export class WorkflowError extends Error {
    constructor(readonly code: WorkflowErrorCode) {
        if (!Object.hasOwnProperty.call(messages, code))
            throw new TypeError('Invalid workflow error code.');
        super(messages[code]);
        this.name = 'WorkflowError';
    }
}
