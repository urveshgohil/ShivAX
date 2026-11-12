// Minimal ambient declarations for the Node built-ins used by the Node-only `shivax/learning/node` entry.
// ShivAX has no @types/node dependency. These types are internal: no public declaration references them.
declare module 'node:worker_threads' {
    export interface ResourceLimits {
        maxOldGenerationSizeMb?: number;
        maxYoungGenerationSizeMb?: number;
        codeRangeSizeMb?: number;
        stackSizeMb?: number;
    }
    export interface WorkerOptions {
        resourceLimits?: ResourceLimits;
        workerData?: unknown;
        stdout?: boolean;
        stderr?: boolean;
    }
    export class Worker {
        constructor(filename: string | URL, options?: WorkerOptions);
        readonly threadId: number;
        postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
        terminate(): Promise<number>;
        on(event: 'message', listener: (value: unknown) => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'messageerror', listener: (error: Error) => void): this;
        once(event: 'exit', listener: (code: number) => void): this;
        removeAllListeners(event?: string): this;
    }
    export interface MessagePortLike {
        postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
        on(event: 'message', listener: (value: unknown) => void): this;
        once(event: 'message', listener: (value: unknown) => void): this;
        close(): void;
    }
    export const parentPort: MessagePortLike | null;
    export const isMainThread: boolean;
}
declare module 'node:os' {
    export function availableParallelism(): number;
}
