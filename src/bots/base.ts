import type {
    Bot,
    BotContext,
    BotInput,
    BotResult,
    BotValue,
    Capability,
    ToolDescriptor,
} from '../agents/types.js';
import { BotError, errorDetails, isErrorCode } from '../agents/errors.js';
import { snapshotInput, snapshotResult, snapshotValue } from '../agents/validation.js';
import { matches, type SpecialistSchema } from './schema.js';

export interface Operation {
    readonly description: string;
    readonly input: SpecialistSchema;
    readonly output: SpecialistSchema;
    readonly tools?: readonly ToolDescriptor[];
    validate?(data: BotValue): boolean;
    run(data: BotValue, context: BotContext): BotValue | Promise<BotValue>;
}
/** Standardizes validation and errors while keeping each specialist's behavior small. */
export abstract class SpecialistBot implements Bot {
    readonly capabilities: readonly Capability[];
    readonly #operations: Readonly<Record<string, Operation>>;
    protected constructor(
        readonly id: string,
        operations: Record<string, Operation>
    ) {
        this.#operations = Object.freeze({ ...operations });
        this.capabilities = Object.freeze(
            Object.entries(operations).map(([id, operation]) =>
                Object.freeze({
                    id,
                    description: operation.description,
                    inputSchema: snapshotValue(operation.input, 65_536, 'invalid-bot'),
                    ...(operation.tools
                        ? {
                              requiredTools: Object.freeze(
                                  operation.tools.map((tool) => Object.freeze({ ...tool }))
                              ),
                          }
                        : {}),
                })
            )
        );
    }
    validateInput(input: BotInput): input is BotInput {
        try {
            const operation = this.#operations[input.capability];
            return (
                !!operation &&
                Object.prototype.hasOwnProperty.call(this.#operations, input.capability) &&
                matches(operation.input, input.data) &&
                (operation.validate?.(input.data) ?? true)
            );
        } catch {
            return false;
        }
    }
    validateOutput(data: BotValue, capability: string): data is BotValue {
        const operation = this.#operations[capability];
        return (
            !!operation &&
            Object.prototype.hasOwnProperty.call(this.#operations, capability) &&
            matches(operation.output, data)
        );
    }
    async execute(input: BotInput, context: BotContext): Promise<BotResult> {
        const identity = { taskId: context.task.taskId, botId: this.id };
        try {
            if (!Object.prototype.hasOwnProperty.call(this.#operations, input.capability))
                throw new BotError('unsupported-capability');
            const safe = snapshotInput(input, context.task.limits.maxInputBytes);
            if (!this.validateInput(safe)) throw new BotError('invalid-input');
            if (context.task.signal.aborted) throw new BotError('cancelled');
            const raw = await this.#operations[safe.capability].run(safe.data, context);
            if (context.task.signal.aborted) throw new BotError('cancelled');
            const data = snapshotValue(raw, context.task.limits.maxOutputBytes, 'invalid-output');
            if (!this.validateOutput(data, safe.capability)) throw new BotError('invalid-output');
            return snapshotResult(
                { ...identity, status: 'completed', data },
                context.task.limits.maxOutputBytes
            );
        } catch (error) {
            const code =
                error instanceof BotError && isErrorCode(error.code) ? error.code : 'bot-error';
            return Object.freeze({
                ...identity,
                status:
                    code === 'cancelled'
                        ? 'cancelled'
                        : code === 'timeout'
                          ? 'timed-out'
                          : 'failed',
                error: errorDetails(code),
            });
        }
    }
}
export async function providerCall(
    callback: (() => unknown | Promise<unknown>) | undefined,
    context: BotContext
): Promise<BotValue> {
    if (!callback) throw new BotError('unavailable');
    let raw: unknown;
    try {
        raw = await callback();
    } catch {
        throw new BotError('provider-error');
    }
    return snapshotValue(raw, context.task.limits.maxOutputBytes, 'invalid-output');
}
export async function toolCall(context: BotContext, id: string, data: BotValue): Promise<BotValue> {
    if (!context.tools) throw new BotError('tool-not-allowed');
    try {
        return await context.tools.execute(id, data);
    } catch {
        throw new BotError('tool-not-allowed');
    }
}
