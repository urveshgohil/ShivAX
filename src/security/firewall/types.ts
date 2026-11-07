import type { BotSignal, BotValue, SecurityContext, TaskContext } from '../../agents/types.js';
import type {
    ModelCapability,
    ModelLimits,
    ModelOutputContract,
    ModelProvider,
} from '../../intelligence/types.js';
import type { Jay } from '../jay.js';
import type { Vijay } from '../vijay.js';
import type { ActionEffect } from '../types.js';

export type FirewallMode = 'enforce' | 'monitor' | 'lockdown';
export type FirewallOperationKind =
    'cpu' | 'tool' | 'model' | 'workflow' | 'bot' | 'file' | 'network';
export type FirewallErrorCode =
    | 'invalid-configuration'
    | 'invalid-policy'
    | 'unauthorized'
    | 'version-conflict'
    | 'policy-unavailable'
    | 'denied'
    | 'lockdown'
    | 'revoked'
    | 'cancelled'
    | 'timeout'
    | 'resource-limit'
    | 'audit-unavailable'
    | 'operation-failed';
export interface FirewallRealm {
    readonly issuer: string;
    readonly scope: SecurityContext['scope'];
}
export interface FirewallRule {
    readonly id: string;
    readonly operationIds: readonly string[];
    readonly decision: 'allow' | 'deny';
    /** Only additional deny rules may be optional. Monitor never creates an allow. */
    readonly optional?: boolean;
}
export interface FirewallLimits {
    readonly maxConcurrent: number;
    /** Lifetime reservations across policy updates and rollback. */
    readonly maxOperations: number;
    readonly maxTokens: number;
    readonly maxCostUSD: number;
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
    readonly timeoutMs: number;
}
export interface FirewallPolicy {
    readonly mode: FirewallMode;
    readonly rules: readonly FirewallRule[];
    readonly providers: {
        readonly ids: readonly string[];
        /** When configured, an omitted provider or capability is denied. */
        readonly capabilities?: readonly { readonly providerId: string; readonly allow: readonly ModelCapability[] }[];
        readonly localities: readonly ('in-process' | 'local' | 'remote')[];
    };
    readonly capabilities: readonly string[];
    readonly bots: readonly string[];
    /** Exact host-canonical absolute paths, never globs or prefix matches. */
    readonly files: { readonly read: readonly string[]; readonly write: readonly string[] };
    /** Exact HTTP(S) origins; transports must enforce redirects/DNS/subresources separately. */
    readonly network: { readonly origins: readonly string[] };
    readonly limits: FirewallLimits;
    readonly audit: { readonly required: boolean };
}
export interface FirewallPolicySnapshot {
    readonly version: number;
    readonly policy: FirewallPolicy;
}
export interface FirewallExecutionContext {
    readonly signal: BotSignal;
    readonly policyVersion: number;
    /** Original Jay context, for trusted integrations only; never pass it to a bot. */
    readonly root: TaskContext;
    /** Recheck immediately before each side effect, including after awaits. */
    checkExecution(): void;
}
interface FirewallOperationBase {
    readonly id: string;
    readonly capability: string;
    readonly effect: ActionEffect;
    readonly botId?: string;
    readonly files: { readonly read: readonly string[]; readonly write: readonly string[] };
    readonly networkOrigins: readonly string[];
}
export interface FirewallHostOperation extends FirewallOperationBase {
    readonly kind: 'cpu' | 'workflow' | 'bot' | 'file' | 'network';
    /** Trusted code must confine effects to declared resources and honor checkpoints. */
    execute(input: BotValue, context: FirewallExecutionContext): unknown | Promise<unknown>;
    /** Mandatory host credential/sandbox/resource predicate; literal true is required. */
    check(input: BotValue, context: FirewallExecutionContext): boolean;
}
export interface FirewallToolOperation extends FirewallOperationBase {
    readonly kind: 'tool';
    readonly toolId: string;
    check(input: BotValue, context: FirewallExecutionContext): boolean;
}
export interface FirewallModelOperation extends FirewallOperationBase {
    readonly kind: 'model';
    readonly provider: ModelProvider;
    readonly modelCapability: ModelCapability;
    readonly output: ModelOutputContract;
    readonly limits: ModelLimits;
    check(input: BotValue, context: FirewallExecutionContext): boolean;
}
export type FirewallOperation =
    FirewallHostOperation | FirewallToolOperation | FirewallModelOperation;
export interface FirewallAuditEvent {
    readonly sequence: number;
    readonly version: number;
    readonly kind: 'decision' | 'policy' | 'cancellation' | 'settled';
    readonly operationId: string | null;
    readonly decision: 'allow' | 'deny' | 'would-deny' | 'observe';
    readonly reason: FirewallErrorCode | 'authorized' | 'optional-rule' | 'updated' | 'completed';
    readonly mode: FirewallMode;
}
export interface FirewallStatus {
    readonly mode: FirewallMode;
    readonly version: number;
    readonly admission: 'open' | 'closed';
    readonly active: number;
    readonly draining: number;
    readonly reservedOperations: number;
    readonly reservedTokens: number;
    readonly reservedCostUSD: number;
    readonly droppedAuditEvents: number;
}
export interface ShivaxFirewallRuntime {
    execute(root: TaskContext, operationId: string, input: BotValue): Promise<BotValue>;
    snapshot(): FirewallPolicySnapshot;
    status(): FirewallStatus;
    audit(): readonly FirewallAuditEvent[];
}
export interface ShivaxFirewallAdmin {
    replace(
        root: TaskContext,
        expectedVersion: number,
        policy: FirewallPolicy
    ): Promise<FirewallPolicySnapshot>;
    /** Revalidates an in-memory historical policy, publishing it under a new version. */
    rollback(
        root: TaskContext,
        expectedVersion: number,
        targetVersion: number
    ): Promise<FirewallPolicySnapshot>;
    lockdown(root: TaskContext, expectedVersion: number): Promise<FirewallPolicySnapshot>;
}
export interface ShivaxFirewallOptions {
    readonly jay: Jay;
    readonly security: Vijay;
    readonly realm: FirewallRealm;
    readonly policy: FirewallPolicy;
    readonly operations: readonly FirewallOperation[];
    /** Separate Vijay capability; its policy must be state-changing (human approval). */
    readonly adminCapability: string;
    /** Separate host role check, never controlled by candidate policy or task data. */
    authorizeAdmin(root: TaskContext, signal: BotSignal): boolean | Promise<boolean>;
    /** Optional bounded acknowledgement; required policies deny if unavailable/false. */
    auditSink?(event: FirewallAuditEvent, signal: BotSignal): boolean | Promise<boolean>;
    readonly auditCapacity?: number;
    /** One-way binding of this controller to existing protected execution on security. */
    readonly protectExecution?: boolean;
}
export interface ShivaxFirewall {
    readonly runtime: ShivaxFirewallRuntime;
    /** Retain at the trusted composition root, never expose to bots or tool payloads. */
    readonly admin: ShivaxFirewallAdmin;
}
