import { BotError } from '../agents/errors.js';
import { checkPredicate, snapshotValue, toolsForCapability } from '../agents/validation.js';
import type { Bot, BotResult, BotSignal, BotValue, TaskContext } from '../agents/types.js';
import { SecurityAuditLog } from './audit.js';
import { SecurityError, securityError } from './errors.js';
import { Jay } from './jay.js';
import { PermissionPolicyRegistry, ProtectedToolRegistry } from './registry.js';
import { ToolLease } from './tools.js';
import {
    enterProtected,
    isFirewallControl,
    noteProtectedUse,
    coreRootChecks,
    hasBinding,
    withProtectedSignal,
} from './firewall/binding.js';
import type { ProtectedLease, ProtectedRequest } from './firewall/binding.js';
import type {
    AuthenticatedIdentity,
    PermissionPolicy,
    SecurityActionKind,
    SecurityApprovalHandler,
} from './types.js';

export interface VijayOptions {
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
    /** Host deadline check, including synchronous work that delays abort timers. */
    checkExecution?(): void;
}

/** Enforces host policy in code. It is a mandatory guard, never a planner-selectable bot. */
export class Vijay {
    readonly #jay: Jay;
    readonly #policies: PermissionPolicyRegistry;
    readonly #tools: ProtectedToolRegistry;
    readonly #approve: SecurityApprovalHandler | undefined;
    readonly #audit: SecurityAuditLog;
    readonly #maxToolCalls: number;
    constructor(jay: Jay, policies: PermissionPolicyRegistry, options: VijayOptions = {}) {
        coreRootChecks.set(this, async (root, signal) => {
            await this.#openTask(root, signal, false);
        });
        this.#jay = jay;
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
        const identity = this.#jay.assertActive(root, signal);
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
        this.#jay.assertActive(root, signal);
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
        const lease = await this.protectTask(root, signal);
        lease?.close();
    }
    /** Retain this task lease until actual planner/bot/tool work has drained. */
    protectTask(root: TaskContext, signal: BotSignal): Promise<ProtectedLease | undefined> {
        return this.#openTask(root, signal, true);
    }
    async #openTask(
        root: TaskContext,
        signal: BotSignal,
        protect: boolean
    ): Promise<ProtectedLease | undefined> {
        noteProtectedUse(this);
        let id = '';
        let lease: ProtectedLease | undefined;
        try {
            await this.#jay.verify(root, signal);
            id = root.input.capability;
            const policy = this.#policies.get('capability', id);
            if (!policy) throw new SecurityError('policy-missing');
            this.#assert(root, policy, root.input.data, signal);
            if (protect && hasBinding(this)) {
                lease = await enterProtected(
                    this,
                    root,
                    { kind: 'task', capability: id },
                    root.input.data,
                    signal
                );
                this.#assert(root, policy, root.input.data, signal);
                lease?.check();
            }
            this.#audit.record(this.#audit.begin(), {
                kind: 'capability',
                actionId: id,
                decision: 'allow',
                reason: 'authorized',
            });
            if (!lease) return undefined;
            const retained = lease;
            return Object.freeze({
                signal: retained.signal,
                maxOutputBytes: retained.maxOutputBytes,
                close: retained.close,
                check: () => {
                    retained.check();
                    this.#assert(root, policy, root.input.data, retained.signal);
                    retained.check();
                },
            });
        } catch (error) {
            lease?.close();
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

    /** Host workflow entry point. Every proposal passes capability and tool policy again. */
    async executeTool(
        root: TaskContext,
        capability: string,
        id: string,
        raw: BotValue,
        signal: BotSignal,
        hooks: SecurityExecutionHooks,
        constraints: {
            readonly readOnly?: boolean;
            readonly effect?: PermissionPolicy['effect'];
            readonly tool?: import('./types.js').ProtectedTool;
        } = {}
    ): Promise<BotValue> {
        const alreadyManaged =
            hooks.checkExecution && isFirewallControl(this, hooks.checkExecution);
        const input = snapshotValue(raw, root.limits.maxInputBytes, 'invalid-input');
        const ensure = () => {
            hooks.checkExecution?.();
            if (!root.security.toolPermissions.includes(id)) throw new SecurityError('tool-denied');
            if (constraints.tool && this.#tools.get(id) !== constraints.tool)
                throw new SecurityError('policy-changed');
            if (constraints.effect && this.#policies.get('tool', id)?.effect !== constraints.effect)
                throw new SecurityError('effect-denied');
            if (
                constraints.readOnly &&
                (this.#policies.get('capability', capability)?.effect !== 'read-only' ||
                    this.#policies.get('tool', id)?.effect !== 'read-only')
            )
                throw new SecurityError('effect-denied');
        };
        return this.#authorized(
            root,
            'capability',
            capability,
            input,
            signal,
            async (parent, _identity, protectedSignal, checkFirewall) => {
                signal = protectedSignal;
                const previous = hooks.checkExecution;
                hooks = {
                    ...hooks,
                    checkExecution: () => {
                        previous?.();
                        checkFirewall();
                    },
                };
                const lease = new ToolLease({
                    root,
                    signal,
                    allowed: [id],
                    maxCalls: 1,
                    checkExecution: hooks.checkExecution,
                    getTool: (name) => this.#tools.get(name),
                    track: hooks.trackTool,
                    checkParent: () => {
                        ensure();
                        this.#assert(root, parent, input, signal);
                    },
                    deny: (name, error) => this.#deny('tool', name, error),
                    authorize: (name, data, childSignal, work, checkTool) =>
                        this.#authorized(
                            root,
                            'tool',
                            name,
                            data,
                            childSignal,
                            (policy, identity, toolSignal, checkFirewall) => {
                                hooks.onEffect?.(policy.effect);
                                checkTool();
                                ensure();
                                this.#assert(root, policy, data, childSignal);
                                return work(policy, identity, toolSignal, checkFirewall);
                            },
                            () => {
                                ensure();
                                checkTool();
                                if (
                                    parent.effect === 'read-only' &&
                                    this.#policies.get('tool', name)?.effect === 'state-changing'
                                )
                                    throw new SecurityError('effect-denied');
                            },
                            hooks.onApproval,
                            alreadyManaged ? false : { kind: 'tool', capability, toolId: name }
                        ),
                });
                try {
                    return await lease.client.execute(id, input);
                } finally {
                    await lease.close();
                }
            },
            ensure,
            hooks.onApproval,
            alreadyManaged ? false : { kind: 'tool', capability, toolId: id }
        );
    }

    async #authorized<T>(
        root: TaskContext,
        kind: SecurityActionKind,
        id: string,
        input: BotValue,
        signal: BotSignal,
        work: (
            policy: PermissionPolicy,
            identity: AuthenticatedIdentity,
            signal: BotSignal,
            checkpoint: () => void
        ) => T | Promise<T>,
        ensure: () => void,
        onApproval: (waiting: boolean) => void,
        request: ProtectedRequest | false = { kind: 'capability', capability: id }
    ): Promise<T> {
        noteProtectedUse(this);
        const operation = this.#audit.begin();
        let lease: ProtectedLease | undefined;
        const baselineEnsure = ensure;
        ensure = () => {
            baselineEnsure();
            lease?.check();
        };
        let policy: PermissionPolicy | undefined,
            admitted = false;
        try {
            await this.#jay.verify(root, signal);
            policy = this.#policies.get(kind, id);
            if (!policy) throw new SecurityError('policy-missing');
            let identity = this.#assert(root, policy, input, signal);
            if (request && hasBinding(this))
                lease = await enterProtected(
                    this,
                    root,
                    {
                        ...request,
                        effect:
                            kind === 'capability' && request.kind === 'tool'
                                ? undefined
                                : policy.effect,
                    },
                    input,
                    signal
                );
            if (lease) signal = lease.signal;
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
                await this.#jay.verify(root, signal);
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
            const value = await work(policy, identity, signal, () => {
                lease?.check();
            });
            if (lease) {
                ensure();
                this.#assert(root, policy, input, signal);
                if (kind === 'tool' || (request && request.kind === 'bot')) {
                    try {
                        snapshotValue(value, lease.maxOutputBytes, 'invalid-output');
                    } catch {
                        throw new SecurityError('invalid-output');
                    }
                }
            }
            return value;
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
        } finally {
            lease?.close();
        }
    }

    /** Trusted host integration: reuse mandatory capability authorization and approvals.
     * The callback receives a live baseline checkpoint, not a transferable authorization.
     */
    async runOperation<T>(
        root: TaskContext,
        capability: string,
        raw: BotValue,
        signal: BotSignal,
        effect: PermissionPolicy['effect'],
        work: (checkpoint: () => void, signal: BotSignal) => T | Promise<T>,
        checkExecution: () => void
    ): Promise<T> {
        const input = snapshotValue(raw, root.limits.maxInputBytes, 'invalid-input');
        const ensure = () => {
            checkExecution();
            if (this.#policies.get('capability', capability)?.effect !== effect)
                throw new SecurityError('effect-denied');
        };
        const outcome = await this.#authorized(
            root,
            'capability',
            capability,
            input,
            signal,
            async (policy, _identity, protectedSignal, checkFirewall) => {
                try {
                    const value = await work(() => {
                        checkFirewall();
                        ensure();
                        this.#assert(root, policy, input, protectedSignal);
                        ensure();
                        checkFirewall();
                    }, protectedSignal);
                    return { ok: true as const, value };
                } catch (error) {
                    return { ok: false as const, error };
                }
            },
            ensure,
            () => {},
            isFirewallControl(this, work) ? false : { kind: 'capability', capability }
        );
        // The callback belongs to the trusted host. Preserve its terminal error
        // classification; authorization failures above remain sanitized SecurityErrors.
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
    }
    /** Host integration point. Bots receive only a leased tool client, never Jay/policies/registries. */
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
            async (parent, _identity, protectedSignal, checkFirewall) => {
                const previous = hooks.checkExecution;
                hooks = {
                    ...hooks,
                    checkExecution: () => {
                        previous?.();
                        checkFirewall();
                    },
                };
                hooks.onEffect?.(parent.effect);
                const secured: Bot = {
                    ...bot,
                    execute: (input, context) =>
                        withProtectedSignal(
                            context.task.signal,
                            protectedSignal === child.signal ? undefined : protectedSignal,
                            async (signal) => {
                                // BotExecutor runs validators after admission; recheck before invoking bot code.
                                if (signal !== context.task.signal)
                                    context = Object.freeze({
                                        ...context,
                                        task: Object.freeze({ ...context.task, signal }),
                                    });
                                try {
                                    hooks.checkExecution?.();
                                    await this.#jay.verify(root, context.task.signal);
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
                                        toolsForCapability(bot, child.input.capability).map(
                                            (tool) => tool.id
                                        )
                                    ),
                                    maxCalls: this.#maxToolCalls,
                                    checkExecution: hooks.checkExecution,
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
                                            hooks.onApproval,
                                            {
                                                kind: 'tool',
                                                capability: child.input.capability,
                                                botId: bot.id,
                                                toolId: id,
                                            }
                                        ),
                                });
                                try {
                                    this.#assert(root, parent, data, context.task.signal);
                                    hooks.checkExecution?.();
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
                            }
                        ),
                };
                return execute(secured);
            },
            () => {
                if (
                    toolsForCapability(bot, child.input.capability).some(
                        (tool) => !root.security.toolPermissions.includes(tool.id)
                    )
                )
                    throw new SecurityError('tool-denied');
            },
            hooks.onApproval,
            { kind: 'bot', capability: child.input.capability, botId: bot.id }
        );
    }
}
