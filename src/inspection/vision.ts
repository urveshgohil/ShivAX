import { providerCall, type Operation } from '../bots/base.js';
import type { VisionModelAdapter, VisionImage } from '../bots/types.js';
import { providerContext } from '../bots/provider.js';
import { matches } from '../bots/schema.js';
import { BotError } from '../agents/errors.js';
import {
    inspectionRequestSchema,
    screenshotRequestSchema,
    visionInterpretationSchema,
} from './contracts.js';
import {
    inspectionJSON,
    inspectionURL,
    inspectionViewport,
    validateInspectionObservation,
} from './validation.js';
import type { ModelRouter } from '../intelligence/router.js';
import type { ModelRoutingOptions } from '../intelligence/types.js';
import { createModelOperation } from '../intelligence/bridge.js';

/** Connect a host-registered image-capable provider; no runtime or network client is installed here. */
export function createInspectionVisionAdapter(
    id: string,
    router: ModelRouter,
    options: ModelRoutingOptions = {}
): VisionModelAdapter {
    if (typeof id !== 'string' || !id.trim() || id.length > 256)
        throw new BotError('invalid-input');
    return Object.freeze({
        id,
        analyze: createModelOperation(
            router,
            'visual-interpretation',
            { schema: visionInterpretationSchema },
            options
        ),
    });
}
export function screenshotInspectionOperation(provider?: VisionModelAdapter): Operation {
    return {
        description:
            'Interpret a screenshot using a configured vision provider; retain estimated, untrusted measurements.',
        input: screenshotRequestSchema,
        output: inspectionRequestSchema,
        validate: (raw) => {
            const input = raw as unknown as {
                image: VisionImage;
                target: string;
                viewport: unknown;
            };
            inspectionURL(input.target);
            inspectionViewport(input.viewport);
            return (
                input.image.base64.length % 4 === 0 &&
                /^[A-Za-z0-9+/]+={0,2}$/.test(input.image.base64)
            );
        },
        run: async (raw, context) => {
            const input = raw as unknown as {
                image: VisionImage;
                target: string;
                viewport: { width: number; height: number };
            };
            const output = await providerCall(
                provider
                    ? () =>
                          provider.analyze(
                              {
                                  image: input.image,
                                  observations: {
                                      viewport: input.viewport,
                                      coordinateSpace: 'css-px',
                                      instruction:
                                          'Return visible element labels, confidence and bounds in the declared CSS-pixel viewport. Do not infer CSS styles or DOM selectors.',
                                  },
                              },
                              providerContext(context)
                          )
                    : undefined,
                context
            );
            if (!matches(visionInterpretationSchema, output)) throw new BotError('invalid-output');
            const observations = (
                output as unknown as {
                    observations: {
                        label: string;
                        confidence: number | null;
                        bounds: { x: number; y: number; width: number; height: number };
                    }[];
                }
            ).observations;
            // An empty/unknown model response cannot establish that the source has no elements.
            if (
                !observations.length ||
                observations.some(
                    (o) =>
                        o.bounds.x + o.bounds.width > input.viewport.width ||
                        o.bounds.y + o.bounds.height > input.viewport.height
                )
            )
                throw new BotError('invalid-output');
            const provenance = {
                sourceType: 'png',
                kind: 'estimated',
                method: `vision:${provider!.id}`,
            };
            const nodes = observations.map((o, i) => ({
                id: `vision-${i}`,
                text: o.label,
                bounds:
                    o.confidence === null
                        ? { status: 'unknown', provenance, confidence: { score: null } }
                        : {
                              status: 'known',
                              value: o.bounds,
                              provenance,
                              confidence: { score: o.confidence },
                          },
            }));
            const observation = validateInspectionObservation(
                {
                    version: 1,
                    providerId: provider!.id,
                    trust: 'untrusted',
                    snapshot: {
                        version: 1,
                        sourceType: 'png',
                        scope: context.task.security.scope,
                        viewport: { ...input.viewport, devicePixelRatio: 1 },
                        coordinates: { unit: 'css-px', unitsPerCssPixel: 1, origin: 'document' },
                        nodes,
                        relationships: [],
                    },
                    elements: nodes.map((n) => ({
                        nodeId: n.id,
                        selector: null,
                        domPath: null,
                        tag: null,
                        visibility: 'unknown',
                    })),
                    screenshot: { status: 'unavailable' },
                },
                context.task.security.scope
            );
            return inspectionJSON({
                reference: { kind: 'observation', observation },
                target: input.target,
                viewport: input.viewport,
            });
        },
    };
}
