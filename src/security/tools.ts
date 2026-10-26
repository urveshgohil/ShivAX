import { checkPredicate, snapshotValue } from '../agents/validation.js';
import type { BotSignal, BotValue, TaskContext } from '../agents/types.js';
import { SecurityError, securityError } from './errors.js';
import type {
    AuthenticatedIdentity,
    BotToolClient,
    PermissionPolicy,
    ProtectedTool,
} from './types.js';

export interface ToolLeaseOptions {
    readonly root: TaskContext;
    readonly signal: BotSignal;
    readonly allowed: readonly string[];
    readonly maxCalls: number;
    checkExecution?(): void;
    getTool(id: string): ProtectedTool | undefined;
    authorize<T>(
        id: string,
        input: BotValue,
        signal: BotSignal,
        work: (policy: PermissionPolicy, identity: AuthenticatedIdentity) => T | Promise<T>,
        ensure: () => void
    ): Promise<T>;
    checkParent(): void;
    deny(id: string, error: SecurityError): void;
    track(callback: () => Promise<BotValue>): Promise<BotValue>;
}

/** A single bot invocation's revocable, non-escalatable tool interface. */
export class ToolLease {
    readonly client: BotToolClient;
    readonly #controller = new AbortController();
    readonly #options: ToolLeaseOptions;
    readonly #pending = new Set<Promise<BotValue>>();
    #open = true;
    #calls = 0;
    #busy = false;
    readonly #cancel = () => this.#controller.abort();
    constructor(options: ToolLeaseOptions) {
        this.#options = options;
        options.signal.addEventListener('abort', this.#cancel, { once: true });
        if (options.signal.aborted) this.#cancel();
        this.client = Object.freeze({
            execute: (id: string, input: BotValue) => {
                // Reject saved/expired clients before touching their former run's tracker.
                try {
                    this.#check();
                } catch (error) {
                    const failure = securityError(error, 'tool-denied');
                    options.deny(id, failure);
                    const rejected = Promise.reject<BotValue>(failure);
                    void rejected.catch(() => {});
                    return rejected;
                }
                const work = options.track(() => this.#execute(id, input));
                this.#pending.add(work);
                void work.then(
                    () => this.#pending.delete(work),
                    () => this.#pending.delete(work)
                );
                return work;
            },
        });
    }
    #check(): void {
        this.#options.checkExecution?.();
        if (!this.#open || this.#controller.signal.aborted || this.#options.signal.aborted)
            throw new SecurityError('cancelled');
        this.#options.checkParent();
        this.#options.checkExecution?.();
    }
    async #execute(id: string, raw: BotValue): Promise<BotValue> {
        const options = this.#options;
        let reserved = false,
            checkedByPolicy = false;
        try {
            this.#check();
            if (++this.#calls > options.maxCalls) throw new SecurityError('tool-limit');
            if (
                typeof id !== 'string' ||
                !options.allowed.includes(id) ||
                !options.root.security.toolPermissions.includes(id)
            )
                throw new SecurityError('tool-denied');
            if (this.#busy) throw new SecurityError('tool-busy');
            this.#busy = true;
            reserved = true;
            const tool = options.getTool(id);
            if (!tool) throw new SecurityError('tool-denied');
            let input: BotValue;
            try {
                input = snapshotValue(raw, options.root.limits.maxInputBytes, 'invalid-input');
            } catch {
                throw new SecurityError('invalid-input');
            }
            const ensure = () => {
                this.#check();
                if (options.getTool(id) !== tool) throw new SecurityError('policy-changed');
                if (!checkPredicate(() => tool.validateInput(input)))
                    throw new SecurityError('invalid-input');
                this.#check();
                if (options.getTool(id) !== tool) throw new SecurityError('policy-changed');
            };
            checkedByPolicy = true;
            return await options.authorize(
                id,
                input,
                this.#controller.signal,
                async (_policy, identity) => {
                    this.#check();
                    let rawOutput: BotValue;
                    try {
                        rawOutput = await tool.execute(
                            input,
                            Object.freeze({ ...identity, signal: this.#controller.signal })
                        );
                    } catch {
                        throw new SecurityError('tool-error');
                    }
                    this.#check();
                    try {
                        const output = snapshotValue(
                            rawOutput,
                            options.root.limits.maxOutputBytes,
                            'invalid-output'
                        );
                        if (!checkPredicate(() => tool.validateOutput(output)))
                            throw new SecurityError('invalid-output');
                        this.#check();
                        return output;
                    } catch (error) {
                        throw securityError(error, 'invalid-output');
                    }
                },
                ensure
            );
        } catch (error) {
            const failure = securityError(error, 'tool-error');
            if (!checkedByPolicy) options.deny(id, failure);
            throw failure;
        } finally {
            if (reserved) this.#busy = false;
        }
    }
    /** Cancel saved clients and drain actual work before the bot relinquishes ownership. */
    async close(): Promise<boolean> {
        this.#open = false;
        this.#cancel();
        try {
            this.#options.signal.removeEventListener('abort', this.#cancel);
        } catch {
            /* Host cleanup. */
        }
        const detached = this.#pending.size > 0;
        await Promise.allSettled([...this.#pending]);
        return detached;
    }
}
