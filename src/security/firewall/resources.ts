import type { MemoryNamespace } from '../../bots/storage.js';
import type { BotSignal } from '../../agents/types.js';
/** Only active, host-issued integration signals receive these resource checks. */
export interface BoundResources {
    namespace(value: MemoryNamespace): void;
    network(url: string): void;
    file(path: string, mode: 'read' | 'write'): void;
}
export const resources = new WeakMap<BotSignal, BoundResources>();
