import { SpecialistBot, providerCall } from './base.js';
import { adapter, providerContext } from './provider.js';
import { id, list, matches, object, text, value } from './schema.js';
import { inspectionOutput, validScene } from './hanuman.js';
import type { ReviewProvider } from './types.js';
import type { BotValue } from '../agents/types.js';
import { BotError } from '../agents/errors.js';

function equal(a: BotValue, b: BotValue): boolean {
    if (a === b) return true;
    if (
        !a ||
        !b ||
        typeof a !== 'object' ||
        typeof b !== 'object' ||
        Array.isArray(a) !== Array.isArray(b)
    )
        return false;
    const x = a as Record<string, BotValue>,
        y = b as Record<string, BotValue>;
    const keys = Object.keys(x);
    return (
        keys.length === Object.keys(y).length &&
        keys.every((key) => Object.prototype.hasOwnProperty.call(y, key) && equal(x[key], y[key]))
    );
}
const check = object(
    { id, path: list(id, 8), operation: { enum: ['exists', 'equals', 'type'] }, expected: value },
    ['id', 'path', 'operation']
);
const checked = list(object({ id, passed: { type: 'boolean' } }));
const resultSchema = object({
    passed: { type: 'boolean' },
    checks: checked,
    source: { enum: ['deterministic-checks'] },
});
export class YudhishthiraBot extends SpecialistBot {
    constructor(model?: ReviewProvider) {
        const provider = adapter(model, 'review');
        super('yudhishthira', {
            'review.check': {
                description: 'Run explicit own-property existence, type and deep-equality checks.',
                input: object({ result: value, checks: { ...list(check), minItems: 1 } }),
                output: resultSchema,
                validate: (data) => {
                    const checks = (
                        data as unknown as {
                            checks: { id: string; operation: string; expected?: BotValue }[];
                        }
                    ).checks;
                    return (
                        new Set(checks.map((check) => check.id)).size === checks.length &&
                        checks.every((check) =>
                            check.operation === 'exists'
                                ? !Object.prototype.hasOwnProperty.call(check, 'expected')
                                : Object.prototype.hasOwnProperty.call(check, 'expected') &&
                                  (check.operation !== 'type' ||
                                      [
                                          'string',
                                          'number',
                                          'boolean',
                                          'null',
                                          'array',
                                          'object',
                                      ].includes(check.expected as string))
                        )
                    );
                },
                run: (data) => {
                    const input = data as unknown as {
                        result: BotValue;
                        checks: {
                            id: string;
                            path: string[];
                            operation: string;
                            expected: BotValue;
                        }[];
                    };
                    const checks = input.checks.map((check) => {
                        let current: BotValue = input.result,
                            found = true;
                        for (const part of check.path) {
                            if (
                                current === null ||
                                typeof current !== 'object' ||
                                !Object.prototype.hasOwnProperty.call(current, part)
                            ) {
                                found = false;
                                break;
                            }
                            current = (current as Record<string, BotValue>)[part];
                        }
                        const type =
                            current === null
                                ? 'null'
                                : Array.isArray(current)
                                  ? 'array'
                                  : typeof current;
                        return {
                            id: check.id,
                            passed:
                                found &&
                                (check.operation === 'exists' ||
                                    (check.operation === 'equals'
                                        ? equal(current, check.expected)
                                        : type === check.expected)),
                        };
                    });
                    return {
                        passed: checks.every((check) => check.passed),
                        checks,
                        source: 'deterministic-checks',
                    };
                },
            },
            'review.inspection': {
                description: 'Check normalization and summary consistency of an inspection result.',
                input: inspectionOutput,
                output: resultSchema,
                validate: (data) => validScene((data as { snapshot: BotValue }).snapshot),
                run: (data) => {
                    const input = data as unknown as {
                        snapshot: {
                            coordinates: { unit: string; unitsPerCssPixel: number };
                            nodes: unknown[];
                            relationships: unknown[];
                            sourceType: string;
                        };
                        summary: {
                            nodeCount: number;
                            relationshipCount: number;
                            sourceType: string;
                        };
                    };
                    const checks = [
                        {
                            id: 'css-coordinates',
                            passed:
                                input.snapshot.coordinates.unit === 'css-px' &&
                                input.snapshot.coordinates.unitsPerCssPixel === 1,
                        },
                        {
                            id: 'node-count',
                            passed: input.snapshot.nodes.length === input.summary.nodeCount,
                        },
                        {
                            id: 'relationship-count',
                            passed:
                                input.snapshot.relationships.length ===
                                input.summary.relationshipCount,
                        },
                        {
                            id: 'source',
                            passed: input.snapshot.sourceType === input.summary.sourceType,
                        },
                    ];
                    return {
                        passed: checks.every((check) => check.passed),
                        checks,
                        source: 'deterministic-checks',
                    };
                },
            },
            'review.model': {
                description:
                    'Request optional advisory model review; does not override deterministic checks.',
                input: object({ result: value, criteria: text }),
                output: object({
                    assessment: { enum: ['pass', 'fail', 'uncertain'] },
                    findings: list(text),
                    advisory: { enum: [true] },
                    providerId: id,
                    source: { enum: ['review-provider'] },
                }),
                run: async (data, context) => {
                    const output = await providerCall(
                        provider
                            ? () => provider.review(data, providerContext(context))
                            : undefined,
                        context
                    );
                    if (
                        !matches(
                            object({
                                assessment: { enum: ['pass', 'fail', 'uncertain'] },
                                findings: list(text),
                            }),
                            output
                        )
                    )
                        throw new BotError('invalid-output');
                    return {
                        ...(output as Record<string, BotValue>),
                        advisory: true,
                        providerId: provider!.id,
                        source: 'review-provider',
                    };
                },
            },
        });
    }
}
