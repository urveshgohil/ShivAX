import { createTaskContext } from '../agents/context.js';
import { array, identifier, record, snapshotValue, limits } from '../agents/validation.js';
import type { BotSignal, BotTask, TaskContext } from '../agents/types.js';
import { SecurityAuditLog } from './audit.js';
import { SecurityError, securityError } from './errors.js';
import type {
    AuthenticatedContextOptions,
    AuthenticatedIdentity,
    IdentityProvider,
} from './types.js';

export function checkSignal(signal: BotSignal): void {
    if (signal.aborted) throw new SecurityError('cancelled');
}

/** Trust is established by a host-configured adapter, never by fields in a task. */
export class Jay {
    readonly #provider: IdentityProvider;
    readonly #contexts = new WeakMap<TaskContext, AuthenticatedIdentity>();
    readonly #now: () => number;
    readonly #audit: SecurityAuditLog;
    constructor(
        provider: IdentityProvider,
        options: { now?: () => number; audit?: SecurityAuditLog } = {}
    ) {
        if (
            !provider ||
            typeof provider.authenticate !== 'function' ||
            typeof provider.isSessionValid !== 'function'
        )
            throw new SecurityError('invalid-identity');
        this.#provider = Object.freeze({
            authenticate: provider.authenticate.bind(provider),
            isSessionValid: provider.isSessionValid.bind(provider),
        });
        this.#now = options.now ?? Date.now;
        this.#audit = options.audit ?? new SecurityAuditLog();
    }
    #active(identity: AuthenticatedIdentity): void {
        const now = this.#now();
        if (!Number.isFinite(now) || identity.session.issuedAt > now)
            throw new SecurityError('invalid-identity');
        if (identity.session.expiresAt <= now) throw new SecurityError('expired-session');
    }
    #identity(value: unknown): AuthenticatedIdentity {
        try {
            const safe = snapshotValue(value, 65_536, 'invalid-context');
            const root = record(safe, ['principal', 'session'], 'invalid-context');
            const principal = record(
                root.principal,
                ['id', 'issuer', 'permissions'],
                'invalid-context'
            );
            identifier(principal.id, 'invalid-context');
            identifier(principal.issuer, 'invalid-context');
            const permissions = array(principal.permissions, 128, 'invalid-context');
            permissions.forEach((value) => identifier(value, 'invalid-context'));
            if (new Set(permissions).size !== permissions.length)
                throw new SecurityError('invalid-identity');
            const session = record(
                root.session,
                ['id', 'principalId', 'issuedAt', 'expiresAt', 'scope'],
                'invalid-context'
            );
            identifier(session.id, 'invalid-context');
            if (
                session.principalId !== principal.id ||
                !Number.isSafeInteger(session.issuedAt) ||
                !Number.isSafeInteger(session.expiresAt) ||
                (session.issuedAt as number) < 0 ||
                (session.expiresAt as number) <= (session.issuedAt as number)
            )
                throw new SecurityError('invalid-identity');
            const scope = record(session.scope, ['id', 'kind'], 'invalid-context');
            identifier(scope.id, 'invalid-context');
            if (scope.kind !== 'personal' && scope.kind !== 'company')
                throw new SecurityError('invalid-identity');
            return safe as unknown as AuthenticatedIdentity;
        } catch {
            throw new SecurityError('invalid-identity');
        }
    }
    async createContext(task: BotTask, options: AuthenticatedContextOptions): Promise<TaskContext> {
        const operation = this.#audit.begin();
        try {
            const host = record(
                options,
                ['signal', 'limits', 'toolPermissions'],
                'invalid-context'
            );
            const signal = host.signal as BotSignal;
            // Validate host signal/options before invoking an identity adapter.
            if (
                !signal ||
                typeof signal.aborted !== 'boolean' ||
                typeof signal.addEventListener !== 'function' ||
                typeof signal.removeEventListener !== 'function' ||
                typeof signal.throwIfAborted !== 'function'
            )
                throw new SecurityError('invalid-identity');
            const executionLimits = limits(host.limits);
            const tools = array(host.toolPermissions ?? [], 128, 'invalid-context').map((value) => {
                identifier(value, 'invalid-context');
                return value;
            });
            checkSignal(signal);
            const identity = this.#identity(await this.#provider.authenticate(signal));
            checkSignal(signal);
            this.#active(identity);
            if ((await this.#provider.isSessionValid(identity, signal)) !== true)
                throw new SecurityError('revoked-session');
            checkSignal(signal);
            this.#active(identity);
            const context = createTaskContext(task, {
                sessionId: identity.session.id,
                signal,
                limits: executionLimits,
                security: {
                    caller: { id: identity.principal.id, issuer: identity.principal.issuer },
                    scope: identity.session.scope,
                    toolPermissions: tools,
                },
            });
            this.#contexts.set(context, identity);
            this.#audit.record(operation, {
                kind: 'authentication',
                actionId: null,
                decision: 'allow',
                reason: 'authorized',
            });
            return context;
        } catch (error) {
            const failure = securityError(error, 'invalid-identity');
            this.#audit.record(operation, {
                kind: 'authentication',
                actionId: null,
                decision: 'deny',
                reason: failure.code,
            });
            throw failure;
        }
    }
    /** Exact minted context required. Copying its public fields does not copy authority. */
    assertActive(context: TaskContext, signal: BotSignal): AuthenticatedIdentity {
        checkSignal(signal);
        const identity = this.#contexts.get(context);
        if (!identity) throw new SecurityError('unauthenticated');
        checkSignal(context.signal);
        this.#active(identity);
        return identity;
    }
    async verify(context: TaskContext, signal: BotSignal): Promise<AuthenticatedIdentity> {
        const identity = this.assertActive(context, signal);
        try {
            if ((await this.#provider.isSessionValid(identity, signal)) !== true)
                throw new SecurityError('revoked-session');
        } catch (error) {
            throw securityError(error, 'revoked-session');
        }
        return this.assertActive(context, signal);
    }
}
