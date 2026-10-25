import { identifier, record, snapshotError, matchesFailureStatus, fail } from './validation.js';
import type { BotEventListener, BotEventMap, BotEventType } from './types.js';

const eventTypes: readonly BotEventType[] = [
    'bot:registered',
    'bot:unregistered',
    'bot:started',
    'bot:completed',
    'bot:failed',
    'bot:cancelled',
    'bot:timed-out',
];
/** Instance-local synchronous observers. Listener failures never change bot execution outcomes. */
export class BotEventEmitter {
    private readonly listeners = new Map<
        BotEventType,
        Set<(event: never) => void | Promise<void>>
    >();
    constructor(private readonly onListenerError?: (error: unknown, type: BotEventType) => void) {}
    on<K extends BotEventType>(type: K, listener: BotEventListener<K>): () => void {
        if (!eventTypes.includes(type) || typeof listener !== 'function') fail('invalid-event');
        let listeners = this.listeners.get(type);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(type, listeners);
        }
        listeners.add(listener as (event: never) => void | Promise<void>);
        return () => this.off(type, listener);
    }
    off<K extends BotEventType>(type: K, listener: BotEventListener<K>): void {
        const listeners = this.listeners.get(type);
        listeners?.delete(listener as (event: never) => void | Promise<void>);
        if (!listeners?.size) this.listeners.delete(type);
    }
    clear(): void {
        this.listeners.clear();
    }
    private report(error: unknown, type: BotEventType): void {
        try {
            void Promise.resolve(this.onListenerError?.(error, type)).catch(() => {});
        } catch {
            /* Observers cannot break dispatch. */
        }
    }
    emit<K extends BotEventType>(type: K, event: BotEventMap[K]): void {
        if (!eventTypes.includes(type)) fail('invalid-event');
        const registration = type === 'bot:registered' || type === 'bot:unregistered';
        const terminalError = ['bot:failed', 'bot:cancelled', 'bot:timed-out'].includes(type);
        const keys = registration
            ? ['botId']
            : ['botId', 'taskId', 'sessionId', ...(terminalError ? ['error'] : [])];
        const value = record(event, keys, 'invalid-event');
        for (const key of keys.filter((key) => key !== 'error'))
            identifier(value[key], 'invalid-event');
        const error = terminalError ? snapshotError(value.error, 'invalid-event') : undefined;
        if (error && !matchesFailureStatus(type.slice(4), error.code)) fail('invalid-event');
        const copy = { ...value, ...(error ? { error } : {}) };
        const snapshot = Object.freeze(copy) as never;
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            try {
                void Promise.resolve(listener(snapshot)).catch((error) => this.report(error, type));
            } catch (error) {
                this.report(error, type);
            }
        }
    }
}
