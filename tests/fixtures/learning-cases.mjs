// Small deterministic contract datasets, not evidence of general model intelligence.
export const learningCases = [
    { id: 'route-code', domain: 'routing', input: 'code.patch', expected: 'vishwakarm' },
    { id: 'route-unknown', domain: 'routing', input: 'nonexistent', expected: null },
    { id: 'plan-valid', domain: 'reasoning', input: { steps: [{ id: 'first', capability: 'code.patch', input: { source: 'task' } }] }, expected: 'completed' },
    { id: 'plan-cycle', domain: 'reasoning', input: { steps: [{ id: 'first', capability: 'code.patch', input: { source: 'step', stepId: 'first' } }] }, expected: 'failed' },
    { id: 'patch-valid', domain: 'code', input: { files: [{ path: 'a.js', language: 'js', content: 'const n = 1;' }], edits: [{ path: 'a.js', oldText: '1', newText: '2' }] }, expected: 'const n = 2;' },
    { id: 'patch-missing', domain: 'code', input: { files: [{ path: 'a.js', language: 'js', content: 'const n = 1;' }], edits: [{ path: 'a.js', oldText: 'missing', newText: '2' }] }, expected: 'failed' },
    { id: 'visual-same', domain: 'visual', input: false, expected: false },
    { id: 'visual-font', domain: 'visual', input: true, expected: true },
    { id: 'permission-denied', domain: 'permission', input: false, expected: false },
    { id: 'permission-approved', domain: 'permission', input: true, expected: true },
    { id: 'memory-hit', domain: 'memory', input: 'known', expected: 'remembered' },
    { id: 'memory-miss', domain: 'memory', input: 'missing', expected: null },
];
