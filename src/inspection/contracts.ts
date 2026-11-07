import { id, list, object, text } from '../bots/schema.js';
export const inspectionViewportSchema = object({
    width: { type: 'number', minimum: 1, maximum: 16384 },
    height: { type: 'number', minimum: 1, maximum: 16384 },
});
export const inspectionObservationSchema = object({
    version: { enum: [1] },
    providerId: id,
    trust: { enum: ['untrusted'] },
    snapshot: { type: 'object', additionalProperties: true },
    elements: list(
        object({
            nodeId: id,
            selector: { oneOf: [text, { type: 'null' }] },
            domPath: { oneOf: [text, { type: 'null' }] },
            tag: { oneOf: [id, { type: 'null' }] },
            visibility: { enum: ['visible', 'unknown'] },
        }),
        64
    ),
    screenshot: {
        oneOf: [
            object({ status: { enum: ['unavailable'] } }),
            object({
                status: { enum: ['available'] },
                width: { type: 'number', minimum: 1 },
                height: { type: 'number', minimum: 1 },
                mimeType: { enum: ['image/png', 'image/jpeg', 'image/webp'] },
                reference: text,
            }),
        ],
    },
});
export const inspectionRequestSchema = object({
    reference: {
        oneOf: [
            object({ kind: { enum: ['url'] }, url: text }),
            object({ kind: { enum: ['observation'] }, observation: inspectionObservationSchema }),
        ],
    },
    target: text,
    viewport: inspectionViewportSchema,
});
export const inspectionPairSchema = object({
    baseline: inspectionObservationSchema,
    target: inspectionObservationSchema,
});
export const inspectionComparisonSchema = object({
    pair: inspectionPairSchema,
    analysis: { type: 'object', additionalProperties: true },
});
export const screenshotRequestSchema = object({
    image: object({
        mimeType: { enum: ['image/png', 'image/jpeg', 'image/webp'] },
        base64: { type: 'string', minLength: 4, maxLength: 262144 },
    }),
    target: text,
    viewport: inspectionViewportSchema,
});
export const visionInterpretationSchema = object({
    summary: text,
    observations: list(
        object({
            label: text,
            confidence: { oneOf: [{ type: 'null' }, { type: 'number', minimum: 0, maximum: 1 }] },
            bounds: object({
                x: { type: 'number', minimum: 0 },
                y: { type: 'number', minimum: 0 },
                width: { type: 'number', minimum: 0 },
                height: { type: 'number', minimum: 0 },
            }),
        }),
        64
    ),
});
