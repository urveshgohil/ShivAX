import { BotExecutor } from '../agents/execute.js';
import { createTaskContext } from '../agents/context.js';
import type { BotValue, TaskContext } from '../agents/types.js';
import type {
    RudraMemoryExecution,
    RudraMemoryHooks,
    RudraMemorySummary,
} from '../agents/rudra/types.js';
import { ChitraguptaBot } from '../bots/chitragupta.js';
import { Vijaya } from '../security/vijaya.js';
import type { MemoryQuery } from './types.js';
import { MemoryError } from './errors.js';
import { json } from './validation.js';
import { snapshotBot } from '../agents/validation.js';

export interface MemoryTaskLifecycleOptions {
    /** Explicit host projection into a bounded retrieval query; omitted means no recall. */
    readonly recall?: (task: TaskContext) => MemoryQuery;
    /** Opt-in status-only history capture. Requires memory.save policy, tool permission and approval. */
    readonly record?: {
        readonly id: (task: TaskContext, summary: RudraMemorySummary) => string;
        readonly ttlMs?: number;
    };
}
/** Uses the actual Chitragupta bot and Vijaya leases for every lifecycle read/write. */
export class MemoryTaskLifecycle implements RudraMemoryHooks {
    readonly #security: Vijaya;
    readonly #bot = snapshotBot(new ChitraguptaBot());
    readonly #executor = new BotExecutor();
    readonly #recall?: MemoryTaskLifecycleOptions['recall'];
    readonly #record?: MemoryTaskLifecycleOptions['record'];
    constructor(security: Vijaya, options: MemoryTaskLifecycleOptions = {}) {
        this.#security = security;
        if (options.recall !== undefined && typeof options.recall !== 'function')
            throw new MemoryError('invalid-input');
        if (options.record && typeof options.record.id !== 'function')
            throw new MemoryError('invalid-input');
        this.#recall = options.recall?.bind(options);
        this.#record = options.record
            ? Object.freeze({
                  id: options.record.id.bind(options.record),
                  ttlMs: options.record.ttlMs,
              })
            : undefined;
    }
    private async execute(
        root: TaskContext,
        capability: string,
        data: BotValue,
        execution: RudraMemoryExecution
    ): Promise<BotValue> {
        execution.checkExecution();
        execution.consumeStep();
        const child = createTaskContext(
            { id: root.taskId, input: { capability, data } },
            {
                sessionId: root.sessionId,
                security: root.security,
                signal: execution.signal,
                limits: { ...root.limits, timeoutMs: execution.timeoutMs },
            }
        );
        const result = await this.#security.runBot(
            root,
            this.#bot,
            child,
            (secured) => this.#executor.execute(secured, child),
            {
                onApproval: execution.onApproval,
                trackTool: execution.trackTool,
                checkExecution: execution.checkExecution,
            }
        );
        execution.checkExecution();
        if (result.status !== 'completed') throw new MemoryError('storage-error');
        return result.data;
    }
    async recall(root: TaskContext, execution: RudraMemoryExecution): Promise<BotValue> {
        if (!this.#recall) return Object.freeze({ matches: [] });
        const query = json({ limit: 5, ...this.#recall(root) });
        return this.execute(root, 'memory.search', query, execution);
    }
    async record(
        root: TaskContext,
        summary: RudraMemorySummary,
        execution: RudraMemoryExecution
    ): Promise<void> {
        if (!this.#record) return;
        const draft = json({
            id: this.#record.id(root, summary),
            category: 'session-history',
            value: {
                status: summary.status,
                completedSteps: summary.completedSteps,
                ...(summary.errorCode ? { errorCode: summary.errorCode } : {}),
            },
            ...(this.#record.ttlMs === undefined ? {} : { ttlMs: this.#record.ttlMs }),
        });
        await this.execute(root, 'memory.save', draft, execution);
    }
}
