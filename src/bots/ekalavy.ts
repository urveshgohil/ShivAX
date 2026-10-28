import { SpecialistBot, toolCall } from './base.js';
import { id, list, object, value } from './schema.js';
import type { BotValue } from '../agents/types.js';
import { learningFeedbackSchema, validateFeedback, storeLearningFeedback } from '../learning/index.js';
import { memoryRecordSchema } from '../memory/contracts.js';

export const feedbackRecordSchema = object(
    {
        kind: { enum: ['feedback', 'training'] },
        data: value,
        score: { type: 'number', minimum: 0, maximum: 1 },
    },
    ['kind', 'data']
);
export const feedbackAckSchema = object({ recordId: id });
export class EkalavyBot extends SpecialistBot {
    constructor() {
        super('ekalavy', {
            'learning.feedback': {
                description: 'Store host-verified accept/reject/correct feedback through Chitragupt memory; never trains weights.',
                input: learningFeedbackSchema,
                output: object({ record: memoryRecordSchema }),
                tools: [{ id: 'shivax.memory.records.save', description: 'Approved verified feedback storage.' }],
                validate: data => { try { validateFeedback(data); return true; } catch { return false; } },
                run: (data, context) => storeLearningFeedback({ execute: (id, input) => toolCall(context, id, input) }, data),
            },
            'learning.record': {
                description:
                    'Store a feedback/training record for explicit later use; never updates weights.',
                input: feedbackRecordSchema,
                output: feedbackAckSchema,
                tools: [
                    {
                        id: 'shivax.feedback.append',
                        description: 'Append one record in the verified session.',
                    },
                ],
                run: (data, context) => toolCall(context, 'shivax.feedback.append', data),
            },
            'learning.summarize': {
                description:
                    'Count supplied feedback and training records and summarize explicit scores.',
                input: object({ records: list(feedbackRecordSchema, 256) }),
                output: object({
                    feedbackCount: { type: 'number' },
                    trainingCount: { type: 'number' },
                    scoredCount: { type: 'number' },
                    meanScore: {
                        oneOf: [{ type: 'null' }, { type: 'number', minimum: 0, maximum: 1 }],
                    },
                    weightsUpdated: { enum: [false] },
                }),
                run: (data) => {
                    const records = (
                        data as {
                            records: readonly { kind: string; score?: number; data: BotValue }[];
                        }
                    ).records;
                    const scores = records.flatMap((record) =>
                        record.score === undefined ? [] : [record.score]
                    );
                    return {
                        feedbackCount: records.filter((record) => record.kind === 'feedback')
                            .length,
                        trainingCount: records.filter((record) => record.kind === 'training')
                            .length,
                        scoredCount: scores.length,
                        meanScore: scores.length
                            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
                            : null,
                        weightsUpdated: false,
                    };
                },
            },
        });
    }
}
