import type { BotSignal, BotValue, TaskContext } from '../../agents/types.js';
import type { Vijay } from '../vijay.js';
import { SecurityError } from '../errors.js';

export interface ProtectedRequest {
    readonly kind: 'task' | 'capability' | 'bot' | 'tool';
    readonly capability: string;
    readonly botId?: string;
    readonly toolId?: string;
    readonly effect?: 'read-only' | 'state-changing';
}
export interface ProtectedLease {
    readonly maxOutputBytes: number;
    readonly signal: BotSignal;
    check(): void;
    close(): void;
}
type Binding = (
    root: TaskContext,
    request: ProtectedRequest,
    input: BotValue,
    signal: BotSignal
) => Promise<ProtectedLease>;
const bindings = new WeakMap<Vijay, Binding>();
// Existing core dispatch already owns its own R04 lease. Reuse just the root Jay/Vijay checks there.
export const coreRootChecks = new WeakMap<
    Vijay,
    (root: TaskContext, signal: BotSignal) => Promise<void>
>();
const owners = new WeakMap<Vijay, object>();
const control = new WeakMap<Function, object>();
const used = new WeakSet<Vijay>();
export function noteProtectedUse(security: Vijay): void {
    used.add(security);
}
/** Internal provenance, never exported from an SDK entrypoint. */
export function firewallControl<T extends Function>(owner: object, work: T): T {
    control.set(work, owner);
    return work;
}
export function ownsBinding(security: Vijay, owner: object): boolean {
    return owners.get(security) === owner;
}
export function hasBinding(security: Vijay): boolean {
    return bindings.has(security);
}
export function isFirewallControl(security: Vijay, work: Function): boolean {
    return control.has(work) && owners.get(security) === control.get(work);
}
export function bindProtectedExecution(security: Vijay, owner: object, binding: Binding): void {
    if (bindings.has(security) || used.has(security)) throw new SecurityError('policy-changed');
    owners.set(security, owner);
    bindings.set(security, binding);
}
export async function enterProtected(
    security: Vijay,
    root: TaskContext,
    request: ProtectedRequest,
    input: BotValue,
    signal: BotSignal
): Promise<ProtectedLease | undefined> {
    try {
        return await bindings.get(security)?.(root, request, input, signal);
    } catch {
        throw new SecurityError('permission-denied');
    }
}

/** Keep the executor's deadline/cancellation when adding a distinct firewall signal. */
export async function withProtectedSignal<T>(
    execution: BotSignal,
    firewall: BotSignal | undefined,
    work: (signal: BotSignal) => Promise<T>
): Promise<T> {
    if (!firewall || execution === firewall) return work(execution);
    const controller = new AbortController();
    const abort = () => controller.abort();
    try {
        execution.addEventListener('abort', abort, { once: true });
        firewall.addEventListener('abort', abort, { once: true });
        if (execution.aborted || firewall.aborted) abort();
        return await work(controller.signal);
    } finally {
        execution.removeEventListener('abort', abort);
        firewall.removeEventListener('abort', abort);
    }
}
