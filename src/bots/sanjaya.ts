import { SpecialistBot, providerCall } from './base.js';
import { id, list, object, text } from './schema.js';
import { adapter, providerContext } from './provider.js';
import type { VisionModelAdapter, VisionImage } from './types.js';
import type { BotValue } from '../agents/types.js';
import { BotError } from '../agents/errors.js';

const bounds = object({
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', minimum: 0 },
    height: { type: 'number', minimum: 0 },
});
const observation = object(
    {
        label: text,
        confidence: { oneOf: [{ type: 'null' }, { type: 'number', minimum: 0, maximum: 1 }] },
        bounds,
    },
    ['label', 'confidence']
);
export const observationInput = object({ observations: list(observation, 256) });
export const observationOutput = object({
    observations: list(observation, 256),
    count: { type: 'number', minimum: 0 },
    source: { enum: ['supplied-observations'] },
});
const imageInput = object(
    {
        image: object({
            mimeType: { enum: ['image/png', 'image/jpeg', 'image/webp'] },
            base64: { type: 'string', minLength: 4, maxLength: 1_048_576 },
        }),
        observations: list(observation, 256),
    },
    ['image']
);
const modelOutput = object({
    summary: text,
    observations: list(observation, 256),
    providerId: id,
    source: { enum: ['model-adapter'] },
});

export class SanjayaBot extends SpecialistBot {
    constructor(model?: VisionModelAdapter) {
        const provider = adapter(model, 'analyze');
        super('sanjaya', {
            'vision.observe': {
                description: 'Validate and preserve supplied visual observations.',
                input: observationInput,
                output: observationOutput,
                run: (data) => {
                    const observations = (data as { observations: readonly BotValue[] })
                        .observations;
                    return {
                        observations,
                        count: observations.length,
                        source: 'supplied-observations',
                    };
                },
            },
            'vision.analyze': {
                description: 'Analyze an encoded image through an explicitly configured adapter.',
                input: imageInput,
                output: modelOutput,
                validate: (data) => {
                    const image = (data as unknown as { image: VisionImage }).image;
                    return (
                        image.base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)
                    );
                },
                run: async (data, context) => {
                    const output = await providerCall(
                        provider
                            ? () =>
                                  provider.analyze(
                                      data as unknown as {
                                          image: VisionImage;
                                          observations?: BotValue;
                                      },
                                      providerContext(context)
                                  )
                            : undefined,
                        context
                    );
                    if (
                        !output ||
                        typeof output !== 'object' ||
                        Array.isArray(output) ||
                        Object.keys(output).sort().join(',') !== 'observations,summary'
                    )
                        throw new BotError('invalid-output');
                    return { ...output, source: 'model-adapter', providerId: provider!.id };
                },
            },
        });
    }
}
