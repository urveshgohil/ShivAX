import {
    array,
    checkPredicate,
    identifier,
    record,
    snapshotValue,
} from '../../agents/validation.js';
import type { BotValue } from '../../agents/types.js';
import { ProtectedToolRegistry } from '../../security/registry.js';
import { resources } from '../../security/firewall/resources.js';
import { publicAddress } from './address.js';
import { bounded, targets } from './target.js';
import { HanumanFetchError } from './error.js';
import { HANUMAN_FETCH_TOOL_ID } from './types.js';
import type {
    HanumanFetchEvent,
    HanumanFetchLimits,
    HanumanFetchServiceOptions,
    HanumanTransportResponse,
} from './types.js';

function input(raw: unknown): string {
    const value = record(raw, ['targetId'], 'invalid-input');
    identifier(value.targetId, 'invalid-input');
    return value.targetId;
}

function validText(body: string, mediaType: string): boolean {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(body)) return false;
    if (mediaType === 'application/json') JSON.parse(body);
    return true;
}

/** Registers a service only. The host supplies grants, policies, approval and firewall operations. */
export function registerHanumanFetchService(
    tools: ProtectedToolRegistry,
    options: HanumanFetchServiceOptions
): void {
    let limits: HanumanFetchLimits;
    let directory: ReturnType<typeof targets>;
    try {
        record(
            options,
            ['transport', 'targets', 'limits', 'authorizeTarget', 'observe'],
            'invalid-input'
        );
        const configured = record(
            options.limits ?? {},
            ['maxResponseBytes', 'maxChunks', 'maxAddresses', 'timeoutMs'],
            'invalid-input'
        );
        limits = Object.freeze({
            maxResponseBytes: bounded(configured.maxResponseBytes ?? 32768, 1048576),
            maxChunks: bounded(configured.maxChunks ?? 4096, 65536),
            maxAddresses: bounded(configured.maxAddresses ?? 16, 64),
            timeoutMs: bounded(configured.timeoutMs ?? 10000, 60000),
        });
        directory = targets(options.targets, limits);
        if (
            typeof options.transport?.resolve !== 'function' ||
            typeof options.transport.request !== 'function' ||
            (options.authorizeTarget !== undefined &&
                typeof options.authorizeTarget !== 'function') ||
            (options.observe !== undefined && typeof options.observe !== 'function')
        )
            throw 0;
    } catch {
        throw new HanumanFetchError('invalid-input');
    }
    const resolve = options.transport.resolve.bind(options.transport);
    const request = options.transport.request.bind(options.transport);
    const authorize = options.authorizeTarget?.bind(options);
    const observe = options.observe?.bind(options);
    const emit = (event: HanumanFetchEvent) => {
        try {
            void Promise.resolve(observe?.(Object.freeze(event))).catch(() => {});
        } catch {
            /* Isolated observer. */
        }
    };
    tools.register({
        id: HANUMAN_FETCH_TOOL_ID,
        validateInput: (raw): raw is BotValue =>
            checkPredicate(() => {
                input(raw);
                return true;
            }),
        validateOutput: (raw): raw is BotValue =>
            checkPredicate(() => {
                const value = record(
                    raw,
                    ['version', 'targetId', 'status', 'mediaType', 'bytes', 'body', 'trust'],
                    'invalid-output'
                );
                const target = directory.get(value.targetId as string);
                return (
                    !!target &&
                    value.version === 1 &&
                    value.status === 200 &&
                    value.trust === 'untrusted' &&
                    target.mediaTypes.includes(value.mediaType as never) &&
                    typeof value.body === 'string' &&
                    validText(value.body, value.mediaType as string) &&
                    new TextEncoder().encode(value.body).length === value.bytes &&
                    (value.bytes as number) <= (target.maxResponseBytes ?? limits.maxResponseBytes)
                );
            }),
        async execute(raw, context) {
            const controller = new AbortController();
            const abort = () => controller.abort();
            let timedOut = false;
            let targetId: string | null = null;
            let response: HanumanTransportResponse | undefined;
            let close: (() => void | Promise<void>) | undefined;
            const now =
                typeof globalThis.performance?.now === 'function'
                    ? globalThis.performance.now.bind(globalThis.performance)
                    : Date.now;
            const deadline = now() + limits.timeoutMs;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, limits.timeoutMs);
            context.signal.addEventListener('abort', abort, { once: true });
            if (context.signal.aborted) abort();
            try {
                // The signal must have an actual SDK-issued resource boundary, in addition to callbacks.
                if (
                    !context.checkExecution ||
                    !context.checkNetworkAccess ||
                    !resources.has(context.signal)
                )
                    throw new HanumanFetchError('network-unprotected');
                const target = directory.get(input(raw));
                if (
                    !target ||
                    target.issuer !== context.principal.issuer ||
                    target.scope.kind !== context.session.scope.kind ||
                    target.scope.id !== context.session.scope.id
                )
                    throw new HanumanFetchError('unknown-target');
                targetId = target.id;
                const check = () => {
                    if (context.signal.aborted) throw new HanumanFetchError('cancelled');
                    if (timedOut || now() >= deadline) throw new HanumanFetchError('timeout');
                    try {
                        context.checkExecution!();
                        context.checkNetworkAccess!(target.url);
                        if (authorize && !checkPredicate(() => authorize(target, context))) throw 0;
                        context.checkExecution!();
                    } catch {
                        throw new HanumanFetchError('destination-denied');
                    }
                };
                check();
                emit({ type: 'admitted', targetId, code: null });
                check();
                const reported = await resolve(
                    Object.freeze({
                        hostname: new URL(target.url).hostname,
                        timeoutMs: Math.max(1, Math.ceil(deadline - now())),
                        signal: controller.signal,
                    })
                );
                check();
                let addresses;
                try {
                    addresses = Object.freeze(
                        array(reported, limits.maxAddresses, 'invalid-input').map(publicAddress)
                    );
                    if (!addresses.length) throw 0;
                } catch {
                    throw new HanumanFetchError('address-denied');
                }
                const maxBytes = target.maxResponseBytes ?? limits.maxResponseBytes;
                check();
                response = await request(
                    Object.freeze({
                        method: 'GET',
                        url: target.url,
                        addresses,
                        headers: Object.freeze({
                            accept: target.mediaTypes.join(', '),
                            'accept-encoding': 'identity',
                        }),
                        redirect: 'error',
                        credentials: 'omit',
                        maxBytes,
                        timeoutMs: Math.max(1, Math.ceil(deadline - now())),
                        signal: controller.signal,
                        checkExecution: check,
                    })
                );
                // Capture cleanup before checking revocation so even a late response is closed.
                if (!response || typeof response.close !== 'function')
                    throw new HanumanFetchError('transport-error');
                close = response.close.bind(response);
                check();
                const peer = publicAddress(response.peer);
                if (
                    !addresses.some(
                        (address) =>
                            address.family === peer.family && address.address === peer.address
                    )
                )
                    throw new HanumanFetchError('address-denied');
                if (response.status >= 300 && response.status < 400)
                    throw new HanumanFetchError('redirect-denied');
                if (response.status !== 200) throw new HanumanFetchError('status-denied');
                if (response.contentEncoding !== null && response.contentEncoding !== 'identity')
                    throw new HanumanFetchError('encoding-denied');
                const media =
                    typeof response.contentType === 'string' &&
                    /^(text\/plain|application\/json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.exec(
                        response.contentType
                    );
                if (!media || !target.mediaTypes.includes(media[1].toLowerCase() as never))
                    throw new HanumanFetchError('media-type-denied');
                if (
                    response.contentLength !== null &&
                    (!Number.isSafeInteger(response.contentLength) ||
                        response.contentLength < 0 ||
                        response.contentLength > maxBytes)
                )
                    throw new HanumanFetchError('response-too-large');
                let bytes = 0,
                    chunks = 0;
                const parts: Uint8Array[] = [];
                for await (const chunk of response.body) {
                    check();
                    if (!(chunk instanceof Uint8Array))
                        throw new HanumanFetchError('transport-error');
                    if (++chunks > limits.maxChunks || chunk.byteLength > maxBytes - bytes)
                        throw new HanumanFetchError('response-too-large');
                    bytes += chunk.byteLength;
                    parts.push(chunk.slice());
                }
                check();
                if (response.contentLength !== null && response.contentLength !== bytes)
                    throw new HanumanFetchError('transport-error');
                const buffer = new Uint8Array(bytes);
                let offset = 0;
                for (const part of parts) {
                    buffer.set(part, offset);
                    offset += part.length;
                }
                let body: string;
                try {
                    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
                        buffer
                    );
                    if (!validText(body, media[1].toLowerCase())) throw 0;
                } catch {
                    throw new HanumanFetchError('invalid-encoding');
                }
                const result = snapshotValue(
                    {
                        version: 1,
                        targetId,
                        status: 200,
                        mediaType: media[1].toLowerCase(),
                        bytes,
                        body,
                        trust: 'untrusted',
                    },
                    1048576,
                    'invalid-output'
                );
                const finish = close;
                close = undefined;
                await finish();
                check();
                emit({ type: 'completed', targetId, code: null });
                check();
                return result;
            } catch (error) {
                controller.abort();
                const failure = context.signal.aborted
                    ? new HanumanFetchError('cancelled')
                    : timedOut || now() >= deadline
                      ? new HanumanFetchError('timeout')
                      : error instanceof HanumanFetchError
                        ? error
                        : new HanumanFetchError('transport-error');
                emit({ type: 'denied', targetId, code: failure.code });
                throw failure;
            } finally {
                try {
                    if (close) {
                        emit({ type: 'draining', targetId, code: null });
                        try {
                            await close();
                        } catch {
                            throw new HanumanFetchError('transport-error');
                        }
                    }
                } finally {
                    controller.abort();
                    clearTimeout(timer);
                    context.signal.removeEventListener('abort', abort);
                    emit({ type: 'settled', targetId, code: null });
                }
            }
        },
    });
}
