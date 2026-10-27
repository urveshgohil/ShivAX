import type { BotSignal, BotValue, ExecutionLimits, SecurityContext } from '../agents/types.js';

export interface AuthenticatedPrincipal {
    readonly id: string;
    readonly issuer: string;
    readonly permissions: readonly string[];
}
/** Session IDs are correlation identifiers, never bearer credentials. */
export interface AuthenticatedSession {
    readonly id: string;
    readonly principalId: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
    readonly scope: SecurityContext['scope'];
}
export interface AuthenticatedIdentity {
    readonly principal: AuthenticatedPrincipal;
    readonly session: AuthenticatedSession;
}
/** Host adapter closes over a verified server/desktop session. Task data is never authentication input. */
export interface IdentityProvider {
    authenticate(signal: BotSignal): unknown | Promise<unknown>;
    isSessionValid(identity: AuthenticatedIdentity, signal: BotSignal): boolean | Promise<boolean>;
}
export interface AuthenticatedContextOptions {
    readonly signal: BotSignal;
    readonly limits?: Partial<ExecutionLimits>;
    /** Host-selected narrowing of tool IDs; permissions still require separate policies. */
    readonly toolPermissions?: readonly string[];
}
export type SecurityActionKind = 'capability' | 'tool';
export type ActionEffect = 'read-only' | 'state-changing';
export interface PermissionPolicy {
    readonly kind: SecurityActionKind;
    readonly id: string;
    readonly permissions: readonly string[];
    readonly effect: ActionEffect;
    /** State-changing actions always require approval, regardless of this flag. */
    readonly requiresApproval?: boolean;
    /** Synchronous schema and resource/scope predicate owned by the host. */
    validateInput(input: BotValue, identity: AuthenticatedIdentity): boolean;
}
export interface ToolExecutionContext extends AuthenticatedIdentity {
    readonly signal: BotSignal;
    /** Host deadline/lease checkpoint before a service begins another side effect. */
    readonly checkExecution?: () => void;
}
export interface ProtectedTool<I extends BotValue = BotValue, O extends BotValue = BotValue> {
    readonly id: string;
    validateInput(input: BotValue): input is I;
    validateOutput(output: BotValue): output is O;
    execute(input: I, context: ToolExecutionContext): O | Promise<O>;
}
/** The only tool interface supplied to a bot: no context/permission/approval setters. */
export interface BotToolClient {
    execute(id: string, input: BotValue): Promise<BotValue>;
}
export interface SecurityApprovalRequest extends AuthenticatedIdentity {
    readonly kind: SecurityActionKind;
    readonly actionId: string;
    readonly effect: ActionEffect;
    readonly input: BotValue;
    readonly signal: BotSignal;
}
export type SecurityApprovalHandler = (
    request: SecurityApprovalRequest
) => boolean | Promise<boolean>;
export type SecurityErrorCode =
    | 'unauthenticated'
    | 'invalid-identity'
    | 'expired-session'
    | 'revoked-session'
    | 'invalid-policy'
    | 'duplicate-policy'
    | 'policy-missing'
    | 'permission-denied'
    | 'invalid-tool'
    | 'duplicate-tool'
    | 'tool-denied'
    | 'invalid-input'
    | 'invalid-output'
    | 'approval-required'
    | 'approval-denied'
    | 'approval-error'
    | 'policy-changed'
    | 'effect-denied'
    | 'cancelled'
    | 'tool-error'
    | 'tool-busy'
    | 'tool-limit';
/** No credentials, principal/session/task IDs, inputs, outputs or exception bodies. */
export interface SecurityDecision {
    readonly sequence: number;
    readonly operation: number;
    readonly kind: 'authentication' | SecurityActionKind;
    /** Only IDs from registered host configuration are recorded; unknown requests use null. */
    readonly actionId: string | null;
    readonly decision: 'allow' | 'deny';
    readonly reason: 'authorized' | SecurityErrorCode;
}
