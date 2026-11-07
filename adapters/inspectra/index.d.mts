import type {
    InspectionProvider,
    InspectionCaptureRequest,
    InspectionProviderContext,
    InspectionObservation,
    InspectionScope,
} from 'shivax';
/** Trusted host must bind the page to owner, install request interception before navigation,
 * check every destination, enforce DNS/proxy isolation and the timeout, and close rejected acquisitions. */
export interface InspectraPageSecurity {
    readonly owner: { readonly issuer: string; readonly principalId: string; readonly sessionId: string;
        readonly scope: InspectionScope };
    readonly maxNodes: number;
    readonly timeoutMs: number;
    checkDestination(url: string): void;
}
export interface InspectraPageLease {
    /** Return the exact contract passed to openPage after applying it to the isolated page. */
    readonly security?: InspectraPageSecurity;
    readonly page: unknown;
    /** Host-selected local path and separately safe opaque artifact reference. Neither comes from task input. */
    readonly screenshot?: { readonly path: string; readonly reference: string };
    /** Must finish cleanup before resolving; the adapter calls once and awaits it, including on cancellation. */
    close(): void | Promise<void>;
}
export interface InspectraAdapterOptions {
    openPage(
        request: InspectionCaptureRequest,
        context: InspectionProviderContext,
        security?: InspectraPageSecurity
    ): Promise<InspectraPageLease>;
    /** unknown avoids binding ShivAX consumers to Playwright's Page type. Runtime checks the real API. */
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
