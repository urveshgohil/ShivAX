import { BotError } from '../agents/errors.js';
import { checkPredicate, snapshotValue } from '../agents/validation.js';
import type { Bot, BotResult, BotSignal, BotValue, TaskContext } from '../agents/types.js';
import { SecurityAuditLog } from './audit.js';
import { SecurityError, securityError } from './errors.js';
import { Jaya } from './jaya.js';
import { PermissionPolicyRegistry, ProtectedToolRegistry } from './registry.js';
import { ToolLease } from './tools.js';
import type {
    AuthenticatedIdentity,
    PermissionPolicy,
    SecurityActionKind,
    SecurityApprovalHandler,
} from './types.js';

export interface VijayaOptions {
    readonly tools?: ProtectedToolRegistry;
    readonly approve?: SecurityApprovalHandler;
    readonly audit?: SecurityAuditLog;
    /** Per bot attempt; includes rejected calls. Default 32; maximum 100. */
    readonly maxToolCalls?: number;
}
export interface SecurityExecutionHooks {
    onApproval(waiting: boolean): void;
    trackTool(callback: () => Promise<BotValue>): Promise<BotValue>;
    onEffect?(effect: PermissionPolicy['effect']): void;
}

/** Enforces host policy in code. It is a mandatory guard, never a planner-selectable bot. */
export class Vijaya {
    readonly #jaya: Jaya;
    readonly #policies: PermissionPolicyRegistry;
    readonly #tools: ProtectedToolRegistry;
    readonly #approve: SecurityApprovalHandler | undefined;
    readonly #audit: SecurityAuditLog;
    readonly #maxToolCalls: number;
    constructor(jaya: Jaya, policies: PermissionPolicyRegistry, options: VijayaOptions = {}) {
        this.#jaya = jaya;
        this.#policies = policies;
        this.#tools = options.tools ?? new ProtectedToolRegistry();
        this.#approve = options.approve;
        this.#audit = options.audit ?? new SecurityAuditLog();
        this.#maxToolCalls = options.maxToolCalls ?? 32;
        if (
            !Number.isSafeInteger(this.#maxToolCalls) ||
            this.#maxToolCalls < 1 ||
            this.#maxToolCalls > 100 ||
            (this.#approve !== undefined && typeof this.#approve !== 'function')
        )
            throw new SecurityError('invalid-policy');
    }
    #assert(
        root: TaskContext,
        policy: PermissionPolicy,
        input: BotValue,
        signal: BotSignal
    ): AuthenticatedIdentity {
        const identity = this.#jaya.assertActive(root, signal);
        if (this.#policies.get(policy.kind, policy.id) !== policy)
            throw new SecurityError('policy-changed');
        if (
            !policy.permissions.every((permission) =>
                identity.principal.permissions.includes(permission)
            )
        )
            throw new SecurityError('permission-denied');
        if (!checkPredicate(() => policy.validateInput(input, identity)))
            throw new SecurityError('invalid-input');
        this.#jaya.assertActive(root, signal);
        if (this.#policies.get(policy.kind, policy.id) !== policy)
            throw new SecurityError('policy-changed');
        return identity;
    }
    #deny(kind: SecurityActionKind, id: string, failure: SecurityError): void {
        this.#audit.record(this.#audit.begin(), {
            kind,
            actionId: typeof id === 'string' && this.#policies.get(kind, id) ? id : null,
            decision: 'deny',
            reason: failure.code,
        });
    }
    /** Admission before planning: authentication and root capability policy, without granting execution. */
    async validateTask(root: TaskContext, signal: BotSignal): Promise<void> {
        let id = '';
        try {
            await this.#jaya.verify(root, signal);
            id = root.input.capability;
            const policy = this.#policies.get('capability', id);
            if (!policy) throw new SecurityError('policy-missing');
            this.#assert(root, policy, root.input.data, signal);
            this.#audit.record(this.#audit.begin(), {
                kind: 'capability',
                actionId: id,
                decision: 'allow',
                reason: 'authorized',
            });
        } catch (error) {
            const failure = securityError(error, 'unauthenticated');
            this.#deny('capability', id, failure);
            throw failure;
        }
    }
    /** Record structural rejection without inspecting or copying untrusted request fields. */
    rejectContext(): void {
        this.#audit.record(this.#audit.begin(), {
            kind: 'authentication',
            actionId: null,
            decision: 'deny',
            reason: 'unauthenticated',
        });
    }

    async #authorized<T>(
        root: TaskContext,
        kind: SecurityActionKind,
        id: string,
        input: BotValue,
        signal: BotSignal,
        work: (policy: PermissionPolicy, identity: AuthenticatedIdentity) => T | Promise<T>,
        ensure: () => void,
        onApproval: (waiting: boolean) => void
    ): Promise<T> {
        const operation = this.#audit.begin();
        let policy: PermissionPolicy | undefined,
            admitted = false;
        try {
            await this.#jaya.verify(root, signal);
            policy = this.#policies.get(kind, id);
            if (!policy) throw new SecurityError('policy-missing');
            let identity = this.#assert(root, policy, input, signal);
            ensure();
            if (policy.requiresApproval) {
                if (!this.#approve) throw new SecurityError('approval-required');
                onApproval(true);
                let approved: unknown;
                try {
                    approved = await this.#approve(
                        Object.freeze({
                            ...identity,
                            kind,
                            actionId: id,
                            effect: policy.effect,
                            input,
                            signal,
                        })
                    );
                } catch {
                    throw new SecurityError('approval-error');
                } finally {
                    onApproval(false);
                }
                if (approved !== true) throw new SecurityError('approval-denied');
                await this.#jaya.verify(root, signal);
            }
            // No await or observer callback between final checks and invoking the protected operation.
            identity = this.#assert(root, policy, input, signal);
            ensure();
            identity = this.#assert(root, policy, input, signal);
            this.#audit.record(operation, {
                kind,
                actionId: policy.id,
                decision: 'allow',
                reason: 'authorized',
            });
            admitted = true;
            return await work(policy, identity);
        } catch (error) {
            const failure = securityError(error, 'tool-error');
            if (!admitted)
                this.#audit.record(operation, {
                    kind,
                    actionId: policy?.id ?? null,
                    decision: 'deny',
                    reason: failure.code,
                });
            throw failure;
        }
    }

    /** Host integration point. Bots receive only a leased tool client, never Jaya/policies/registries. */
    async runBot(
        root: TaskContext,
        bot: Bot,
        child: TaskContext,
        execute: (secured: Bot) => Promise<BotResult>,
        hooks: SecurityExecutionHooks
    ): Promise<BotResult> {
        const data = snapshotValue(child.input.data, child.limits.maxInputBytes, 'invalid-input');
        return this.#authorized(
            root,
            'capability',
            child.input.capability,
            data,
            child.signal,
            async (parent) => {
                hooks.onEffect?.(parent.effect);
                const secured: Bot = {
                    ...bot,
                    execute: async (input, context) => {
                        // BotExecutor runs validators after admission; recheck before invoking bot code.
                        try {
                            await this.#jaya.verify(root, context.task.signal);
                            this.#assert(root, parent, data, context.task.signal);
                        } catch (error) {
                            const failure = securityError(error, 'unauthenticated');
                            this.#deny('capability', parent.id, failure);
                            throw new BotError('tool-not-allowed');
                        }
                        const lease = new ToolLease({
                            root,
                            signal: context.task.signal,
                            allowed: Object.freeze(
                                (bot.requiredTools ?? []).map((tool) => tool.id)
                            ),
                            maxCalls: this.#maxToolCalls,
                            getTool: (id) => this.#tools.get(id),
                            track: hooks.trackTool,
                            checkParent: () => {
                                this.#assert(root, parent, data, context.task.signal);
                            },
                            deny: (id, error) => this.#deny('tool', id, error),
                            authorize: (id, input, signal, work, ensure) =>
                                this.#authorized(
                                    root,
                                    'tool',
                                    id,
                                    input,
                                    signal,
                                    work,
                                    () => {
                                        ensure();
                                        if (
                                            parent.effect === 'read-only' &&
                                            this.#policies.get('tool', id)?.effect ===
                                                'state-changing'
                                        )
                                            throw new SecurityError('effect-denied');
                                    },
                                    hooks.onApproval
                                ),
                        });
                        try {
                            const result = await bot.execute(
                                input,
                                Object.freeze({ ...context, tools: lease.client })
                            );
                            if (await lease.close()) throw new BotError('tool-not-allowed');
                            return result;
                        } catch (error) {
                            await lease.close();
                            // Security denials must not become retryable bot-error outcomes.
                            if (error instanceof SecurityError)
                                throw new BotError('tool-not-allowed');
                            throw error;
                        }
                    },
                };
                return execute(secured);
            },
            () => {
                if (
                    bot.requiredTools?.some(
                        (tool) => !root.security.toolPermissions.includes(tool.id)
                    )
                )
                    throw new SecurityError('tool-denied');
            },
            hooks.onApproval
        );
    }
}
