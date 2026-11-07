import { SpecialistBot, providerCall } from './base.js';
import { adapter, providerContext } from './provider.js';
import { id, list, object, text, value } from './schema.js';
import { plan as validatePlan } from '../agents/rudra/validation.js';
import { BotError } from '../agents/errors.js';
import type { BotValue } from '../agents/types.js';
import type { ReasoningProvider } from './types.js';

const stepInput = {
    oneOf: [
        object({ source: { enum: ['task'] } }),
        object({ source: { enum: ['literal'] }, data: value }),
        object({ source: { enum: ['step'] }, stepId: id }),
    ],
};
const workflow = object({
    steps: { ...list(object({ id, capability: id, input: stepInput }), 100), minItems: 1 },
});
const planRequest = object(
    {
        goal: text,
        allowedCapabilities: { ...list(id), minItems: 1 },
        maxSteps: { type: 'number', minimum: 1, maximum: 100 },
    },
    ['goal', 'allowedCapabilities']
);
const decisionInput = object({
    question: text,
    options: { ...list(object({ id, label: text })), minItems: 1 },
    evidence: list(object({ id, text })),
});
const decisionOutput = object({
    selectedOptionId: id,
    rationale: text,
    evidenceIds: list(id),
    providerId: id,
    source: { enum: ['reasoning-provider'] },
});

export class BrihaspatiBot extends SpecialistBot {
    constructor(model?: ReasoningProvider) {
        const provider = adapter(model, 'decide');
        const planner = model?.plan === undefined ? undefined : adapter(model, 'plan');
        super('brihaspati', {
            'reasoning.plan': {
                description:
                    'Validate an explicit workflow or a bounded injected-provider plan; never executes it.',
                input: { oneOf: [workflow, planRequest] },
                output: {
                    oneOf: [
                        object({ plan: workflow, source: { enum: ['validated-explicit-plan'] } }),
                        object({
                            plan: workflow,
                            providerId: id,
                            source: { enum: ['reasoning-provider'] },
                        }),
                    ],
                },
                run: async (data, context): Promise<BotValue> => {
                    if (!Object.prototype.hasOwnProperty.call(data, 'steps')) {
                        const request = data as {
                            goal: string;
                            allowedCapabilities: readonly string[];
                            maxSteps?: number;
                        };
                        if (
                            !Number.isSafeInteger(request.maxSteps ?? 16) ||
                            new Set(request.allowedCapabilities).size !==
                                request.allowedCapabilities.length
                        )
                            throw new BotError('invalid-input');
                        const proposed = await providerCall(
                            planner
                                ? () => planner.plan!(data, providerContext(context))
                                : undefined,
                            context
                        );
                        try {
                            const plan = validatePlan(
                                proposed,
                                request.maxSteps ?? 16,
                                context.task.limits.maxInputBytes
                            );
                            if (
                                plan.steps.some(
                                    (step) => !request.allowedCapabilities.includes(step.capability)
                                )
                            )
                                throw new BotError('invalid-output');
                            return {
                                plan: plan as unknown as BotValue,
                                source: 'reasoning-provider',
                                providerId: planner!.id,
                            };
                        } catch {
                            throw new BotError('invalid-output');
                        }
                    }
                    try {
                        return {
                            plan: validatePlan(
                                data,
                                100,
                                context.task.limits.maxInputBytes
                            ) as unknown as BotValue,
                            source: 'validated-explicit-plan',
                        };
                    } catch {
                        throw new BotError('invalid-input');
                    }
                },
            },
            'reasoning.decide': {
                description:
                    'Ask an injected provider for a decision grounded in supplied option/evidence IDs.',
                input: decisionInput,
                output: decisionOutput,
                validate: (data) => {
                    const input = data as {
                        options: readonly { id: string }[];
                        evidence: readonly { id: string }[];
                    };
                    return [input.options, input.evidence].every(
                        (items) => new Set(items.map((item) => item.id)).size === items.length
                    );
                },
                run: async (data, context) => {
                    const output = await providerCall(
                        provider
                            ? () => provider.decide(data, providerContext(context))
                            : undefined,
                        context
                    );
                    const result = output as Readonly<Record<string, BotValue>>;
                    const input = data as {
                        options: readonly { id: string }[];
                        evidence: readonly { id: string }[];
                    };
                    if (
                        !output ||
                        typeof output !== 'object' ||
                        Array.isArray(output) ||
                        Object.keys(output).sort().join(',') !==
                            'evidenceIds,rationale,selectedOptionId' ||
                        !input.options.some((option) => option.id === result.selectedOptionId) ||
                        !Array.isArray(result.evidenceIds) ||
                        !result.evidenceIds.every((id: BotValue) =>
                            input.evidence.some((item) => item.id === id)
                        )
                    )
                        throw new BotError('invalid-output');
                    return { ...output, providerId: provider!.id, source: 'reasoning-provider' };
                },
            },
        });
    }
}
