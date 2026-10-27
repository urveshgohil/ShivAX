import { SpecialistBot } from './base.js';
import { object } from './schema.js';
import { normalizeUISnapshot, validateUISnapshot } from '../visual/validation.js';
import { analyzeUI } from '../visual/analysis/index.js';
import type { UISnapshot } from '../visual/types.js';
import type { BotContext, BotValue } from '../agents/types.js';
import { BotError } from '../agents/errors.js';
import { inspectionOperations } from '../inspection/operations.js';

const snapshotSchema = { type: 'object', additionalProperties: true } as const;
export const inspectionOutput = object({
    snapshot: snapshotSchema,
    summary: object({
        nodeCount: { type: 'number', minimum: 0 },
        relationshipCount: { type: 'number', minimum: 0 },
        sourceType: { enum: ['url', 'figma', 'png'] },
    }),
    source: { enum: ['deterministic-ui-normalization'] },
});
export function validScene(value: BotValue): boolean {
    try {
        validateUISnapshot(value);
        return true;
    } catch {
        return false;
    }
}
function scene(value: BotValue, context: BotContext): UISnapshot {
    validateUISnapshot(value);
    const scope = context.task.security.scope;
    if (value.scope.kind !== scope.kind || value.scope.id !== scope.id)
        throw new BotError('tool-not-allowed');
    return value;
}
export class HanumanBot extends SpecialistBot {
    constructor() {
        super('hanuman', {
            ...inspectionOperations,
            'inspection.normalize': {
                description: 'Validate and normalize supplied UI data; does not capture browsers.',
                input: object({ snapshot: snapshotSchema }),
                output: inspectionOutput,
                validate: (data) => validScene((data as { snapshot: BotValue }).snapshot),
                run: (data, context) => {
                    const snapshot = normalizeUISnapshot(
                        scene((data as { snapshot: BotValue }).snapshot, context)
                    );
                    return {
                        snapshot: snapshot as unknown as BotValue,
                        summary: {
                            nodeCount: snapshot.nodes.length,
                            relationshipCount: snapshot.relationships.length,
                            sourceType: snapshot.sourceType,
                        },
                        source: 'deterministic-ui-normalization',
                    };
                },
            },
            'inspection.compare': {
                description: 'Run existing deterministic UI analysis on two supplied snapshots.',
                input: object({ baseline: snapshotSchema, target: snapshotSchema }),
                output: object({
                    analysis: snapshotSchema,
                    source: { enum: ['deterministic-ui-analysis'] },
                }),
                validate: (data) => {
                    const pair = data as { baseline: BotValue; target: BotValue };
                    return validScene(pair.baseline) && validScene(pair.target);
                },
                run: (data, context) => {
                    const pair = data as { baseline: BotValue; target: BotValue };
                    return {
                        analysis: analyzeUI(
                            normalizeUISnapshot(scene(pair.baseline, context)),
                            normalizeUISnapshot(scene(pair.target, context))
                        ) as unknown as BotValue,
                        source: 'deterministic-ui-analysis',
                    };
                },
            },
        });
    }
}
