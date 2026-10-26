import { SpecialistBot, toolCall } from './base.js';
import { id, object, value } from './schema.js';

export const memoryReadInput = object({ key: id });
export const memoryWriteInput = object({ key: id, value });
export const memoryReadOutput = {
    oneOf: [
        object({ found: { enum: [false] } }),
        object({ found: { enum: [true] }, value, revision: { type: 'number', minimum: 1 } }),
    ],
};
export const memoryWriteOutput = object({ key: id, revision: { type: 'number', minimum: 1 } });
export class ChitraguptaBot extends SpecialistBot {
    constructor() {
        super('chitragupta', {
            'memory.read': {
                description: 'Read from the authenticated session memory namespace.',
                input: memoryReadInput,
                output: memoryReadOutput,
                tools: [
                    {
                        id: 'shivax.memory.read',
                        description: 'Read one key in the verified session.',
                    },
                ],
                run: (data, context) => toolCall(context, 'shivax.memory.read', data),
            },
            'memory.write': {
                description: 'Write through the approved session storage interface.',
                input: memoryWriteInput,
                output: memoryWriteOutput,
                tools: [
                    {
                        id: 'shivax.memory.write',
                        description: 'Store one bounded value in the verified session.',
                    },
                ],
                run: (data, context) => toolCall(context, 'shivax.memory.write', data),
            },
        });
    }
}
