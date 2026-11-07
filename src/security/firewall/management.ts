import type { BotSignal, TaskContext } from '../../agents/types.js';
import { snapshotValue } from '../../agents/validation.js';
import { FirewallError } from './errors.js';
import { operations } from './operations.js';
import { count, id, object, policy, realm } from './policy.js';
import { createManagedFirewall } from './runtime.js';
import type {
    FirewallPolicy,
    FirewallPolicySnapshot,
    FirewallRealm,
    ShivaxFirewallOptions,
    ShivaxFirewallRuntime,
} from './types.js';

export type FirewallManagementAction =
    'read-policy' | 'read-configuration' | 'change' | 'lockdown' | 'read-audit';
export interface FirewallPolicyProfile {
    readonly id: string;
    readonly policy: FirewallPolicy;
}
export interface FirewallAuthorizationRecord {
    readonly version: number;
    readonly action: 'bootstrap' | 'change' | 'lockdown';
    /** Opaque host-issued reference. The identity mapping stays in protected host storage. */
    readonly actorRef: string;
}
export interface FirewallStoredPolicy {
    readonly format: 'shivax-firewall-policy';
    readonly schemaVersion: 1;
    readonly realm: FirewallRealm;
    readonly version: number;
    readonly profileId: string;
    readonly policy: FirewallPolicy;
    /** Bounded recent history. The store must archive the full protected journal atomically. */
    readonly history: readonly FirewallAuthorizationRecord[];
}
/** Exclusive lifetime ownership of this realm. Implement with a fenced host lock/transaction.
 * No other process may serve this realm from an old policy while this lease is active. */
export interface FirewallPolicyLease {
    assertOwnership(): void;
    load(signal: BotSignal): Promise<unknown>;
    /** Atomically CAS the policy AND append its protected authorization record.
     * Call check immediately before durable commit, after every async preparation.
     * False means conflict. Throw for failure/ambiguous acknowledgement. Never log raw values. */
    commit(
        expectedVersion: number,
        next: FirewallStoredPolicy,
        check: () => void,
        signal: BotSignal
    ): Promise<boolean>;
    close(): Promise<void>;
}
export interface FirewallPolicyStore {
    /** Fixed host-selected store/realm, never selected by a request body. */
    acquire(signal: BotSignal): Promise<FirewallPolicyLease>;
}
export interface FirewallManagementOptions<Request> {
    readonly firewall: Omit<ShivaxFirewallOptions, 'policy'>;
    readonly profiles: readonly FirewallPolicyProfile[];
    readonly store: FirewallPolicyStore;
    /** Authenticate the transport/session and mint a Jay root from trusted host data. */
    authenticate(request: Request, signal: BotSignal): Promise<TaskContext>;
    /** Fresh action-specific role check. Return only an opaque audit reference, or null. */
    authorize(
        root: TaskContext,
        action: FirewallManagementAction,
        signal: BotSignal
    ): Promise<string | null>;
    /** Synchronous revocation fence for the verified host authorization, checked at commit.
     * Must check current session/role state, never claims from task data. */
    checkAuthorization(
        root: TaskContext,
        action: FirewallManagementAction,
        actorRef: string
    ): boolean;
    readonly timeoutMs?: number;
}
export interface FirewallChangeRequest {
    readonly expectedVersion: number;
    readonly profileId: string;
}
export interface FirewallLockdownRequest {
    readonly expectedVersion: number;
}
export interface FirewallManagement<Request> {
    readPolicy(
        request: Request,
        signal: BotSignal
    ): Promise<FirewallPolicySnapshot & { readonly admission: 'open' | 'closed' }>;
    readConfiguration(
        request: Request,
        signal: BotSignal
    ): Promise<readonly FirewallPolicyProfile[]>;
    requestChange(
        request: Request,
        command: FirewallChangeRequest,
        signal: BotSignal
    ): Promise<FirewallPolicySnapshot>;
    lockdown(
        request: Request,
        command: FirewallLockdownRequest,
        signal: BotSignal
    ): Promise<FirewallPolicySnapshot>;
    readAudit(
        request: Request,
        signal: BotSignal
    ): Promise<{
        readonly changes: readonly {
            readonly version: number;
            readonly action: FirewallAuthorizationRecord['action'];
        }[];
        readonly runtime: ReturnType<ShivaxFirewallRuntime['audit']>;
    }>;
}
export interface ManagedShivaxFirewall<Request> {
    readonly runtime: ShivaxFirewallRuntime;
    /** Host-only controller. Never register it as a bot tool or place it in task context. */
    readonly management: FirewallManagement<Request>;
    close(): Promise<void>;
}
const opaque = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(
                  Object.keys(item)
                      .sort()
                      .map((key) => [key, item[key]])
              )
            : item
    );

/** Transport-neutral host adapter. Missing/corrupt storage never creates a runtime or writes defaults. */
export async function openShivaxFirewallManagement<Request>(
    options: FirewallManagementOptions<Request>,
    startupSignal: BotSignal
): Promise<ManagedShivaxFirewall<Request>> {
    const lifetime = new AbortController();
    let lease: FirewallPolicyLease | undefined,
        faulted = false;
    const stop = () => {
        faulted = true;
        lifetime.abort();
    };
    const check = () => {
        if (faulted || startupSignal.aborted) throw new FirewallError('policy-unavailable');
        try {
            lease!.assertOwnership();
        } catch {
            stop();
            throw new FirewallError('policy-unavailable');
        }
    };
    const abortStartup = () => stop();
    startupSignal.addEventListener('abort', abortStartup, { once: true });
    try {
        startupSignal.throwIfAborted();
        const timeoutMs = options.timeoutMs ?? 5000;
        count(timeoutMs, 1, 300000);
        if (
            typeof options.authenticate !== 'function' ||
            typeof options.authorize !== 'function' ||
            typeof options.checkAuthorization !== 'function' ||
            typeof options.store?.acquire !== 'function'
        )
            throw new FirewallError('invalid-configuration');
        const authenticate = options.authenticate.bind(options);
        const authorize = options.authorize.bind(options);
        const checkAuthorization = options.checkAuthorization.bind(options);
        const config = Object.freeze({
            ...options.firewall,
            authorizeAdmin: options.firewall.authorizeAdmin.bind(options.firewall),
        });
        const registered = operations(config.operations),
            hostRealm = realm(config.realm);
        const profiles = new Map<string, FirewallPolicyProfile>();
        if (
            !Array.isArray(options.profiles) ||
            options.profiles.length < 1 ||
            options.profiles.length > 32
        )
            throw new FirewallError('invalid-configuration');
        for (const entry of options.profiles) {
            object(entry, ['id', 'policy']);
            id(entry.id);
            if (profiles.has(entry.id)) throw new FirewallError('invalid-configuration');
            profiles.set(
                entry.id,
                Object.freeze({ id: entry.id, policy: policy(entry.policy, registered) })
            );
        }
        lease = await options.store.acquire(startupSignal);
        check();
        const saved = snapshotValue(await lease.load(startupSignal), 1_048_576, 'invalid-input');
        check();
        const fields = object(saved, [
            'format',
            'schemaVersion',
            'realm',
            'version',
            'profileId',
            'policy',
            'history',
        ]);
        if (
            fields.format !== 'shivax-firewall-policy' ||
            fields.schemaVersion !== 1 ||
            canonical(realm(fields.realm)) !== canonical(hostRealm)
        )
            throw new FirewallError('invalid-policy');
        count(fields.version, 1, Number.MAX_SAFE_INTEGER);
        id(fields.profileId);
        const selected = profiles.get(fields.profileId);
        const restored = policy(fields.policy, registered);
        if (
            !selected ||
            canonical(restored) !==
                canonical(
                    restored.mode === 'lockdown'
                        ? { ...selected.policy, mode: 'lockdown' }
                        : selected.policy
                )
        )
            throw new FirewallError('invalid-policy');
        if (
            !Array.isArray(fields.history) ||
            fields.history.length < 1 ||
            fields.history.length > 256
        )
            throw new FirewallError('invalid-policy');
        let previous = 0;
        for (const raw of fields.history) {
            const event = object(raw, ['version', 'action', 'actorRef']);
            count(event.version, previous + 1, Number.MAX_SAFE_INTEGER);
            if (
                !['bootstrap', 'change', 'lockdown'].includes(event.action as string) ||
                !opaque(event.actorRef)
            )
                throw new FirewallError('invalid-policy');
            if (event.action === 'bootstrap' && event.version !== 1)
                throw new FirewallError('invalid-policy');
            previous = event.version as number;
        }
        if (previous !== fields.version || (fields.version === 1 && restored.mode !== 'enforce'))
            throw new FirewallError('invalid-policy');
        let stored = saved as unknown as FirewallStoredPolicy;
        let mutation:
            | {
                  root: TaskContext;
                  action: 'change' | 'lockdown';
                  actorRef: string;
                  profileId: string;
                  signal: BotSignal;
              }
            | undefined;
        const authorizeRoot = async (
            root: TaskContext,
            action: FirewallManagementAction,
            signal: BotSignal,
            expectedActor?: string
        ) => {
            check();
            signal.throwIfAborted();
            try {
                const identity = await config.jay.verify(root, signal);
                if (
                    identity.principal.issuer !== hostRealm.issuer ||
                    identity.session.scope.kind !== hostRealm.scope.kind ||
                    identity.session.scope.id !== hostRealm.scope.id ||
                    (await config.authorizeAdmin(root, signal)) !== true
                )
                    throw 0;
                const actor = await authorize(root, action, signal);
                check();
                signal.throwIfAborted();
                config.jay.assertActive(root, signal);
                if (
                    !opaque(actor) ||
                    (expectedActor !== undefined && actor !== expectedActor) ||
                    checkAuthorization(root, action, actor) !== true
                )
                    throw 0;
                return actor;
            } catch {
                throw new FirewallError('unauthorized');
            }
        };
        const writes = new Set<Promise<unknown>>();
        let closing: Promise<void> | undefined;
        const firewall = createManagedFirewall(
            { ...config, realm: hostRealm, operations: [...registered.values()], policy: restored },
            {
                version: stored.version,
                signal: lifetime.signal,
                check,
                failed: stop,
                persist(root, next, signal, coreCheck) {
                    const pending = (async () => {
                        const active = mutation;
                        if (!active || active.root !== root)
                            throw new FirewallError('unauthorized');
                        try {
                            await authorizeRoot(
                                root,
                                active.action,
                                active.signal,
                                active.actorRef
                            );
                            const guard = () => {
                                check();
                                signal.throwIfAborted();
                                active.signal.throwIfAborted();
                                coreCheck();
                                if (
                                    mutation !== active ||
                                    !checkAuthorization(root, active.action, active.actorRef)
                                )
                                    throw new FirewallError('unauthorized');
                            };
                            guard();
                            const record = snapshotValue(
                                {
                                    format: 'shivax-firewall-policy',
                                    schemaVersion: 1,
                                    realm: hostRealm,
                                    version: next.version,
                                    profileId: active.profileId,
                                    policy: next.policy,
                                    history: [
                                        ...stored.history.slice(-255),
                                        {
                                            version: next.version,
                                            action: active.action,
                                            actorRef: active.actorRef,
                                        },
                                    ],
                                },
                                1_048_576,
                                'invalid-input'
                            ) as unknown as FirewallStoredPolicy;
                            if (!(await lease!.commit(stored.version, record, guard, signal))) {
                                stop();
                                throw new FirewallError('version-conflict');
                            }
                            guard();
                            stored = record;
                            return guard;
                        } catch (error) {
                            stop();
                            throw error instanceof FirewallError
                                ? error
                                : new FirewallError('policy-unavailable');
                        }
                    })();
                    writes.add(pending);
                    void pending.then(
                        () => writes.delete(pending),
                        () => writes.delete(pending)
                    );
                    return pending;
                },
            }
        );
        const run = async <T>(
            request: Request,
            action: FirewallManagementAction,
            signal: BotSignal,
            work: (root: TaskContext, actor: string, signal: BotSignal) => Promise<T> | T
        ): Promise<T> => {
            const controller = new AbortController();
            const cancel = () => controller.abort();
            const timer = setTimeout(cancel, timeoutMs);
            signal.addEventListener('abort', cancel, { once: true });
            lifetime.signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted || lifetime.signal.aborted) cancel();
            let rejectAbort: () => void = () => {};
            const aborted = new Promise<never>((_, reject) => {
                rejectAbort = () => reject(new FirewallError('policy-unavailable'));
                controller.signal.addEventListener('abort', rejectAbort, { once: true });
                if (controller.signal.aborted) rejectAbort();
            });
            const pending = (async () => {
                check();
                controller.signal.throwIfAborted();
                let root: TaskContext;
                try {
                    root = await authenticate(request, controller.signal);
                } catch {
                    throw new FirewallError('unauthorized');
                }
                const actor = await authorizeRoot(root, action, controller.signal);
                const result = await work(root, actor, controller.signal);
                await authorizeRoot(root, action, controller.signal, actor);
                return result;
            })();
            try {
                return await Promise.race([pending, aborted]);
            } catch (error) {
                throw error instanceof FirewallError ? error : new FirewallError('unauthorized');
            } finally {
                controller.abort();
                clearTimeout(timer);
                signal.removeEventListener('abort', cancel);
                lifetime.signal.removeEventListener('abort', cancel);
                controller.signal.removeEventListener('abort', rejectAbort);
            }
        };
        const change = (
            request: Request,
            command: unknown,
            action: 'change' | 'lockdown',
            signal: BotSignal
        ) => {
            // Snapshot before awaits so a client cannot mutate the chosen profile/version during authentication.
            let captured: unknown;
            try {
                captured = snapshotValue(command, 4096, 'invalid-input');
            } catch {
                captured = null;
            }
            return run(request, action, signal, async (root, actor, authorizedSignal) => {
                let value: Record<string, unknown>;
                try {
                    value = object(
                        captured,
                        action === 'change' ? ['expectedVersion', 'profileId'] : ['expectedVersion']
                    );
                    count(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER);
                    if (action === 'change') id(value.profileId);
                } catch {
                    throw new FirewallError('invalid-policy');
                }
                if (mutation || value.expectedVersion !== firewall.runtime.snapshot().version)
                    throw new FirewallError('version-conflict');
                const profileId =
                    action === 'change' ? (value.profileId as string) : stored.profileId;
                const profile = profiles.get(profileId);
                if (!profile) throw new FirewallError('invalid-policy');
                mutation = { root, action, actorRef: actor, profileId, signal: authorizedSignal };
                try {
                    await authorizeRoot(root, action, authorizedSignal, actor);
                    return action === 'change'
                        ? await firewall.admin.replace(
                              root,
                              value.expectedVersion as number,
                              profile.policy
                          )
                        : await firewall.admin.lockdown(root, value.expectedVersion as number);
                } finally {
                    mutation = undefined;
                }
            });
        };
        return Object.freeze({
            runtime: firewall.runtime,
            management: Object.freeze({
                readPolicy: (request: Request, signal: BotSignal) =>
                    run(request, 'read-policy', signal, () =>
                        Object.freeze({
                            ...firewall.runtime.snapshot(),
                            admission: firewall.runtime.status().admission,
                        })
                    ),
                readConfiguration: (request: Request, signal: BotSignal) =>
                    run(request, 'read-configuration', signal, () =>
                        Object.freeze([...profiles.values()])
                    ),
                requestChange: (
                    request: Request,
                    command: FirewallChangeRequest,
                    signal: BotSignal
                ) => change(request, command, 'change', signal),
                lockdown: (request: Request, command: FirewallLockdownRequest, signal: BotSignal) =>
                    change(request, command, 'lockdown', signal),
                readAudit: (request: Request, signal: BotSignal) =>
                    run(request, 'read-audit', signal, () =>
                        Object.freeze({
                            changes: Object.freeze(
                                stored.history.map(({ version, action }) =>
                                    Object.freeze({ version, action })
                                )
                            ),
                            runtime: firewall.runtime.audit(),
                        })
                    ),
            }),
            close() {
                return (closing ??= (async () => {
                    stop();
                    startupSignal.removeEventListener('abort', abortStartup);
                    // A timed-out writer still owns the lease until its real storage work settles.
                    await Promise.allSettled([...writes]);
                    try {
                        await lease!.close();
                    } catch {
                        throw new FirewallError('policy-unavailable');
                    }
                })());
            },
        });
    } catch {
        stop();
        startupSignal.removeEventListener('abort', abortStartup);
        try {
            await lease?.close();
        } catch {
            /* Never expose storage errors or paths. */
        }
        throw new FirewallError('policy-unavailable');
    }
}
