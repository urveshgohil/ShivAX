import type {
    InspectionProvider,
    InspectionCaptureRequest,
    InspectionProviderContext,
    InspectionObservation,
    InspectionScope,
} from 'shivax';
export interface InspectraPageLease {
    readonly page: unknown;
    /** Host-selected local path and separately safe opaque artifact reference. Neither comes from task input. */
    readonly screenshot?: { readonly path: string; readonly reference: string };
    /** Must be idempotent; cancellation and final cleanup can both call it. */
    close(): void | Promise<void>;
}
export interface InspectraAdapterOptions {
    openPage(
        request: InspectionCaptureRequest,
        context: InspectionProviderContext
    ): Promise<InspectraPageLease>;
    /** unknown avoids binding SHIVAX consumers to Playwright's Page type. Runtime checks the real API. */
    load?(): Promise<unknown>;
    maxNodes?: number;
    timeout?: number;
}
export declare class InspectraInspectionProvider implements InspectionProvider {
    readonly id: string;
    constructor(options: InspectraAdapterOptions);
    capture(
        request: InspectionCaptureRequest,
        context: InspectionProviderContext
    ): Promise<InspectionObservation>;
}
export declare function normalizeInspectraCapture(
    raw: unknown,
    options?: { scope?: InspectionScope; screenshotReference?: string }
): InspectionObservation;
