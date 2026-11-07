import { resources } from '../security/firewall/resources.js';
import type { BotSignal, BotValue } from '../agents/types.js';
import { checkPredicate } from '../agents/validation.js';
import type { AuthenticatedIdentity, ProtectedTool } from '../security/types.js';
import { ProtectedToolRegistry } from '../security/registry.js';
import { SecurityError } from '../security/errors.js';
import { matches } from '../bots/schema.js';
import type { MemoryNamespace } from '../bots/storage.js';
import type { MemoryDraft, MemoryPatch, MemoryQuery, MemoryStore } from './types.js';
import { MEMORY_ACTIONS } from './contracts.js';
export interface MemoryServiceOptions {
    /** Additional host evidence/consent checks. Defaults deny both special categories. */
    readonly approvePreference?: (
        record: MemoryDraft | MemoryPatch,
        identity: AuthenticatedIdentity
    ) => boolean;
    readonly verifyOutcome?: (
        record: MemoryDraft | MemoryPatch,
        identity: AuthenticatedIdentity
    ) => boolean;
}
export function memoryNamespace(identity: AuthenticatedIdentity): MemoryNamespace {
    return Object.freeze({
        principalId: identity.principal.id,
        issuer: identity.principal.issuer,
        sessionId: identity.session.id,
        scopeKind: identity.session.scope.kind,
        scopeId: identity.session.scope.id,
    });
}
/** Implementations only. Host must register policies and explicit approval; this function grants nothing. */
export function registerMemoryServices(
    tools: ProtectedToolRegistry,
    store: MemoryStore,
    options: MemoryServiceOptions = {}
): void {
    const preference = options.approvePreference?.bind(options),
        outcome = options.verifyOutcome?.bind(options);
    const definitions: ProtectedTool[] = MEMORY_ACTIONS.map((action) => ({
        id: action.toolId,
        validateInput: (input): input is BotValue => matches(action.input, input),
        validateOutput: (output): output is BotValue => matches(action.output, output),
        async execute(raw, context): Promise<BotValue> {
            const ns = memoryNamespace(context),
                input = raw as Record<string, BotValue>;
            // Preserve the portable signal contract and cancellation events while
            // carrying the host's absolute deadline through embedding and persistence.
            const signal: BotSignal = Object.freeze({
                get aborted() {
                    return context.signal.aborted;
                },
                get reason() {
                    return context.signal.reason;
                },
                throwIfAborted() {
                    context.checkExecution?.();
                    context.signal.throwIfAborted();
                },
                addEventListener: context.signal.addEventListener.bind(context.signal),
                removeEventListener: context.signal.removeEventListener.bind(context.signal),
            });
            const boundary = resources.get(context.signal);
            if (boundary) resources.set(signal, boundary);
            signal.throwIfAborted();
            const approval = (record: MemoryDraft | MemoryPatch) => {
                signal.throwIfAborted();
                const userApproved =
                    !!preference && checkPredicate(() => preference(record, context));
                signal.throwIfAborted();
                const outcomeVerified = !!outcome && checkPredicate(() => outcome(record, context));
                signal.throwIfAborted();
                return { userApproved, outcomeVerified };
            };
            switch (action.action) {
                case 'save':
                    return {
                        record: await store.save(
                            ns,
                            raw as unknown as MemoryDraft,
                            signal,
                            approval(raw as unknown as MemoryDraft)
                        ),
                    } as unknown as BotValue;
                case 'retrieve':
                    return {
                        record: await store.retrieve(ns, input.id as string, signal),
                    } as unknown as BotValue;
                case 'update':
                    return {
                        record: await store.update(
                            ns,
                            input.id as string,
                            input.patch as unknown as MemoryPatch,
                            signal,
                            {
                                ...approval(input.patch as unknown as MemoryPatch),
                                expectedRevision: input.expectedRevision as number | undefined,
                                expectedGeneration: input.expectedGeneration as
                                    string | null | undefined,
                            }
                        ),
                    } as unknown as BotValue;
                case 'delete':
                    return {
                        deleted: await store.delete(
                            ns,
                            input.id as string,
                            signal,
                            input.expectedRevision as number | undefined,
                            input.expectedGeneration as string | null | undefined
                        ),
                    };
                case 'search':
                    return {
                        matches: await store.search(ns, raw as unknown as MemoryQuery, signal),
                    } as unknown as BotValue;
                case 'list':
                    return {
                        records: await store.list(ns, raw as unknown as MemoryQuery, signal),
                    } as unknown as BotValue;
                case 'export':
                    return (await store.export(ns, signal)) as unknown as BotValue;
                case 'purge':
                    return { removed: await store.purgeExpired(ns, signal) };
            }
        },
    }));
    if (definitions.some((tool) => tools.get(tool.id))) throw new SecurityError('duplicate-tool');
    definitions.forEach((tool) => tools.register(tool));
}
