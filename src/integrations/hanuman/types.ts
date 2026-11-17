import type { BotSignal } from '../../agents/types.js';
import type { ToolExecutionContext } from '../../security/types.js';

export const HANUMAN_BOT_ID = 'hanuman';
export const HANUMAN_FETCH_CAPABILITY = 'hanuman.fetch';
export const HANUMAN_FETCH_TOOL_ID = 'shivax.hanuman.fetch';

export type HanumanMediaType = 'text/plain' | 'application/json';

/** Host-registered and frozen at registration. The only source of URLs. */
export interface HanumanFetchTarget {
    readonly id: string; // identifier(); unique per service
    readonly url: string; // canonical https URL: new URL(url).href === url
    readonly issuer: string; // must equal principal.issuer
    readonly scope: { readonly kind: 'personal' | 'company'; readonly id: string };
    readonly mediaTypes: readonly HanumanMediaType[]; // non-empty, unique
    readonly maxResponseBytes?: number; // ≤ service limit
}

export interface HanumanFetchLimits {
    readonly maxResponseBytes: number; // default 32_768; 1..1_048_576
    readonly maxChunks: number; // default 4_096; 1..65_536
    readonly maxAddresses: number; // default 16; 1..64 DNS answers
    readonly timeoutMs: number; // default 10_000; 1..60_000; min with lease deadline
}

/** Canonical form only: dotted-quad IPv4 or RFC 5952 IPv6, no brackets or zone. */
export interface HanumanAddress {
    readonly family: 4 | 6;
    readonly address: string;
}

export interface HanumanResolveRequest {
    readonly hostname: string; // ASCII hostname from the canonical target URL
    readonly timeoutMs: number;
    readonly signal: BotSignal;
}

/** Frozen. The transport must not add headers, credentials, cookies or redirects. */
export interface HanumanTransportRequest {
    readonly method: 'GET';
    readonly url: string; // exact canonical target URL; WHATWG parser required
    readonly addresses: readonly HanumanAddress[]; // vetted pin set; connect only to one of these
    readonly headers: Readonly<{ accept: string; 'accept-encoding': 'identity' }>;
    readonly redirect: 'error';
    readonly credentials: 'omit';
    readonly maxBytes: number; // wire cap the transport must also enforce
    readonly timeoutMs: number;
    readonly signal: BotSignal;
    /** Live lease checkpoint. Call before connect, before reading headers, and per chunk. */
    checkExecution(): void;
}

export interface HanumanTransportResponse {
    readonly status: number;
    readonly contentType: string | null;
    readonly contentLength: number | null;
    readonly contentEncoding: string | null; // must be null or 'identity'; no transparent decoding
    readonly peer: HanumanAddress; // the address actually connected
    readonly body: AsyncIterable<Uint8Array>;
    /** Idempotent. Must settle even after abort. Awaited by the SDK on every path. */
    close(): void | Promise<void>;
}

/** Implemented by the trusted host. SHIVAX ships no implementation. */
export interface HanumanFetchTransport {
    resolve(request: HanumanResolveRequest): Promise<readonly HanumanAddress[]>;
    request(request: HanumanTransportRequest): Promise<HanumanTransportResponse>;
}

export interface HanumanFetchServiceOptions {
    readonly transport: HanumanFetchTransport;
    readonly targets: readonly HanumanFetchTarget[];
    readonly limits?: Partial<HanumanFetchLimits>;
    /** Optional synchronous host narrowing; literal `true` required; cannot add targets. */
    authorizeTarget?(target: Readonly<HanumanFetchTarget>, context: ToolExecutionContext): boolean;
    /** Optional isolated observer: IDs and codes only; failures and delays cannot change outcomes. */
    observe?(event: HanumanFetchEvent): void;
}

export interface HanumanFetchInput {
    readonly targetId: string;
}

/** Tool and bot output. A BotValue: JSON-safe, frozen, no headers or URLs. */
export interface HanumanFetchResult {
    readonly version: 1;
    readonly targetId: string;
    readonly status: 200;
    readonly mediaType: HanumanMediaType;
    readonly bytes: number;
    readonly body: string;
    readonly trust: 'untrusted';
}

export type HanumanFetchErrorCode =
    | 'invalid-input'
    | 'unknown-target'
    | 'network-unprotected'
    | 'destination-denied'
    | 'address-denied'
    | 'redirect-denied'
    | 'status-denied'
    | 'media-type-denied'
    | 'encoding-denied'
    | 'invalid-encoding'
    | 'response-too-large'
    | 'timeout'
    | 'cancelled'
    | 'transport-error';

export interface HanumanFetchEvent {
    readonly type: 'admitted' | 'denied' | 'completed' | 'draining' | 'settled';
    readonly targetId: string | null; // only registered IDs; unknown → null
    readonly code: HanumanFetchErrorCode | null;
}
