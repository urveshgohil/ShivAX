import type { Operation } from '../bots/base.js';
import { toolCall } from '../bots/base.js';
import { object } from '../bots/schema.js';
import { BotError } from '../agents/errors.js';
import type { BotValue } from '../agents/types.js';
import { analyzeUI } from '../visual/analysis/index.js';
import {
    inspectionPairSchema,
    inspectionComparisonSchema,
    inspectionRequestSchema,
} from './contracts.js';
import { inspectionJSON, inspectionPair } from './validation.js';
import type { InspectionObservation } from './types.js';

const anyObject = { type: 'object', additionalProperties: true } as const;
function same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (
        !a ||
        !b ||
        typeof a !== 'object' ||
        typeof b !== 'object' ||
        Array.isArray(a) !== Array.isArray(b)
    )
        return false;
    const x = a as Record<string, unknown>,
        y = b as Record<string, unknown>;
    return (
        Object.keys(x).length === Object.keys(y).length &&
        Object.keys(x).every((k) => Object.prototype.hasOwnProperty.call(y, k) && same(x[k], y[k]))
    );
}
export const inspectionOperations: Record<string, Operation> = {
    'inspection.scan': {
        description: 'Capture approved URLs through a host inspection provider.',
        input: inspectionRequestSchema,
        output: inspectionPairSchema,
        tools: [
            {
                id: 'shivax.inspection.capture',
                description: 'Host-approved browser capture; may create host-selected artifacts.',
            },
        ],
        run: (data, context) => toolCall(context, 'shivax.inspection.capture', data),
    },
    'inspection.compare-captured': {
        description:
            'Match semantic/structural elements before deterministic visual measurement comparison.',
        input: inspectionPairSchema,
        output: inspectionComparisonSchema,
        run: (data, context) => {
            const pair = inspectionPair(data, context.task.security.scope);
            const analysis = analyzeUI(pair.baseline.snapshot, pair.target.snapshot);
            return inspectionJSON({ pair, analysis });
        },
    },
};
export const inspectionReviewOperation: Operation = {
    description:
        'Recompute findings from supplied evidence; validates consistency, not capture authenticity.',
    input: inspectionComparisonSchema,
    output: object({
        validated: { enum: [true] },
        trust: { enum: ['untrusted'] },
        findings: { type: 'array', items: anyObject, maxItems: 512 },
        diagnostics: { type: 'array', items: anyObject, maxItems: 1024 },
        review: { enum: ['deterministic-recomputation'] },
    }),
    run: (raw, context) => {
        const data = raw as { pair: BotValue; analysis: BotValue },
            pair = inspectionPair(data.pair, context.task.security.scope);
        const analysis = analyzeUI(pair.baseline.snapshot, pair.target.snapshot);
        if (!same(analysis, data.analysis)) throw new BotError('invalid-output');
        const element = (observation: InspectionObservation, id: string | null) =>
            id === null
                ? null
                : {
                      nodeId: id,
                      role: observation.snapshot.nodes.find((n) => n.id === id)?.role ?? null,
                      selector: observation.elements.find((n) => n.nodeId === id)?.selector ?? null,
                  };
        return inspectionJSON({
            validated: true,
            trust: 'untrusted',
            review: 'deterministic-recomputation',
            diagnostics: analysis.diagnostics,
            findings: analysis.issues.map((issue) => ({
                ...issue,
                issueType: issue.category,
                referenceElement: element(pair.baseline, issue.baselineNodeId),
                targetElement: element(pair.target, issue.targetNodeId),
                evidence: issue.supportingMeasurements,
            })),
        });
    },
};
