import type { BotSignal, SecurityContext } from '../agents/types.js';
import type { UISnapshot } from '../visual/types.js';
import type { AuthenticatedIdentity } from '../security/types.js';

export interface InspectionViewport {
    readonly width: number;
    readonly height: number;
}
/** Sidecar metadata keeps the established UISnapshot contract unchanged. */
export interface InspectionObservation {
    readonly version: 1;
    readonly providerId: string;
    readonly trust: 'untrusted';
    readonly snapshot: UISnapshot;
    readonly elements: readonly {
        readonly nodeId: string;
        readonly selector: string | null;
        readonly domPath: string | null;
        readonly tag: string | null;
        /** Visible in the rendered document, not necessarily inside the viewport. */
        readonly visibility: 'visible' | 'unknown';
    }[];
    readonly screenshot:
        | { readonly status: 'unavailable' }
        | {
              readonly status: 'available';
              readonly width: number;
              readonly height: number;
              readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
              /** Opaque host artifact handle. Never opened by ShivAX. */
              readonly reference: string;
          };
}
export interface InspectionCaptureRequest {
    readonly url: string;
    readonly viewport: InspectionViewport;
}
export interface InspectionProviderContext extends AuthenticatedIdentity {
    readonly signal: BotSignal;
    readonly checkExecution?: () => void;
    /** Host transport must call for every navigation, redirect and subresource. */
    readonly checkNetworkAccess?: (url: string) => void;
    readonly checkFileAccess?: (path: string, mode: 'read' | 'write') => void;
}
/** Host owns browser navigation, resource restrictions and cleanup. No implicit global provider. */
export interface InspectionProvider {
    readonly id: string;
    capture(
        request: InspectionCaptureRequest,
        context: InspectionProviderContext
    ): unknown | Promise<unknown>;
}
export interface InspectionRequest {
    readonly reference:
        | { readonly kind: 'url'; readonly url: string }
        | { readonly kind: 'observation'; readonly observation: InspectionObservation };
    readonly target: string;
    readonly viewport: InspectionViewport;
}
export interface InspectionPair {
    readonly baseline: InspectionObservation;
    readonly target: InspectionObservation;
}
export interface InspectionServiceOptions {
    /** Required host resource policy, applied to every URL before any capture. */
    authorizeURL(url: string, identity: AuthenticatedIdentity): boolean;
    /** Default deny supplied references; host binds approved reference data to this identity. */
    authorizeReference?(
        observation: InspectionObservation,
        identity: AuthenticatedIdentity
    ): boolean;
}
export type InspectionScope = SecurityContext['scope'];
