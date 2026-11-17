import { BotError } from '../agents/errors.js';
import type { BotRegistry } from '../agents/registry.js';
import type { BotValue } from '../agents/types.js';
import { record, snapshotValue } from '../agents/validation.js';
import {
    HANUMAN_BOT_ID,
    HANUMAN_FETCH_TOOL_ID,
    type HanumanMediaType,
} from '../integrations/hanuman/types.js';
import type { ProtectedToolRegistry } from '../security/registry.js';
import { SpecialistBot, toolCall, type Operation } from './base.js';
import { id, object } from './schema.js';

export const HANUMAN_FETCH_URL_CAPABILITY = 'fetch.url';
/** These IDs are reserved until they have reviewed protected tool contracts. */
export const HANUMAN_RESERVED_CAPABILITIES = Object.freeze([
    'fetch.api',
    'research.search',
] as const);

export type HanumanFetchUrlInput = {
    readonly version: 1;
    readonly operation: typeof HANUMAN_FETCH_URL_CAPABILITY;
    readonly request: { readonly targetId: string };
    readonly options?: { readonly maxExcerptChars?: number };
};

export type HanumanEvidence = {
    readonly version: 1;
    readonly evidenceId: string;
    readonly source: { readonly kind: 'registered-target'; readonly targetId: string };
    readonly retrievedAt: string;
    readonly status: 'retrieved';
    readonly mediaType: HanumanMediaType;
    readonly bytes: number;
    readonly excerpt: string;
    readonly truncated: boolean;
    readonly trust: 'untrusted';
    readonly provenance: {
        readonly botId: typeof HANUMAN_BOT_ID;
        readonly capability: typeof HANUMAN_FETCH_URL_CAPABILITY;
        readonly toolId: typeof HANUMAN_FETCH_TOOL_ID;
    };
};

export interface HanumanBotOptions {
    /** Upper bound in UTF-16 units. Defaults to 4096. */
    readonly maxExcerptChars?: number;
    /** UTC receipt-time clock. Defaults to Date.now. */
    readonly now?: () => number;
}

export interface RegisterHanumanBotOptions extends HanumanBotOptions {
    /** Availability check only. Use the same registry for protected execution. */
    readonly tools: ProtectedToolRegistry;
}

const maxExcerpt = 8192;
const excerptLimit = { type: 'number', minimum: 1, maximum: maxExcerpt } as const;
const mediaTypes = ['text/plain', 'application/json'] as const;
const provenance = Object.freeze({
    botId: HANUMAN_BOT_ID,
    capability: HANUMAN_FETCH_URL_CAPABILITY,
    toolId: HANUMAN_FETCH_TOOL_ID,
});
const inputSchema = object(
    {
        version: { enum: [1] },
        operation: { enum: [HANUMAN_FETCH_URL_CAPABILITY] },
        request: object({ targetId: id }),
        options: object({ maxExcerptChars: excerptLimit }, []),
    },
    ['version', 'operation', 'request']
);
const evidenceSchema = object({
    version: { enum: [1] },
    evidenceId: { type: 'string', minLength: 72, maxLength: 72 },
    source: object({ kind: { enum: ['registered-target'] }, targetId: id }),
    retrievedAt: { type: 'string', minLength: 24, maxLength: 27 },
    status: { enum: ['retrieved'] },
    mediaType: { enum: mediaTypes },
    bytes: { type: 'number', minimum: 0, maximum: 1_048_576 },
    excerpt: { type: 'string', maxLength: maxExcerpt },
    truncated: { type: 'boolean' },
    trust: { enum: ['untrusted'] },
    provenance: object({
        botId: { enum: [provenance.botId] },
        capability: { enum: [provenance.capability] },
        toolId: { enum: [provenance.toolId] },
    }),
});

function isExcerptLimit(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 1 &&
        value <= maxExcerpt
    );
}

function botOptions(options: Record<string, unknown>): Required<HanumanBotOptions> {
    const { maxExcerptChars = 4096, now = Date.now } = options;
    if (!isExcerptLimit(maxExcerptChars) || typeof now !== 'function')
        throw new BotError('invalid-input');
    return { maxExcerptChars, now: now as () => number };
}

function fetchBody(
    raw: BotValue,
    targetId: string,
    outputBudget: number
): { body: string; bytes: number; mediaType: HanumanMediaType } {
    const result = record(
        snapshotValue(raw, outputBudget, 'invalid-output'),
        ['version', 'targetId', 'status', 'mediaType', 'bytes', 'body', 'trust'],
        'invalid-output'
    );
    const { body, bytes, mediaType } = result;
    if (
        result.version !== 1 ||
        result.targetId !== targetId ||
        result.status !== 200 ||
        result.trust !== 'untrusted' ||
        (mediaType !== 'text/plain' && mediaType !== 'application/json') ||
        typeof body !== 'string' ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(body) ||
        bytes !== new TextEncoder().encode(body).length
    )
        throw new BotError('invalid-output');
    return { body, bytes, mediaType };
}

function retrieval(options: Required<HanumanBotOptions>): Operation {
    return {
        description: 'Retrieve bounded untrusted evidence from a host-registered target.',
        input: inputSchema,
        output: evidenceSchema,
        tools: [
            { id: HANUMAN_FETCH_TOOL_ID, description: 'Retrieve an approved registered target.' },
        ],
        validate(data) {
            const input = data as HanumanFetchUrlInput;
            const limit = input.options?.maxExcerptChars;
            return (
                !/[:/\\?#@\s\u0000-\u001f\u007f-\u009f]/u.test(input.request.targetId) &&
                (limit === undefined || isExcerptLimit(limit))
            );
        },
        async run(data, context) {
            const input = data as HanumanFetchUrlInput;
            const { targetId } = input.request;
            const subtle = globalThis.crypto?.subtle;
            if (typeof subtle?.digest !== 'function') throw new BotError('unavailable');
            const raw = await toolCall(context, HANUMAN_FETCH_TOOL_ID, { targetId });
            if (context.task.signal.aborted) throw new BotError('cancelled');
            const { body, bytes, mediaType } = fetchBody(
                raw,
                targetId,
                context.task.limits.maxOutputBytes
            );
            const received = options.now();
            if (!Number.isFinite(received) || Math.abs(received) > 8.64e15)
                throw new BotError('bot-error');

            let end = Math.min(
                body.length,
                options.maxExcerptChars,
                input.options?.maxExcerptChars ?? maxExcerpt
            );
            const last = body.charCodeAt(end - 1);
            if (end < body.length && last >= 0xd800 && last <= 0xdbff) end--;

            const { kind: scopeKind, id: scopeId } = context.task.security.scope;
            // Lexicographic key order gives the v1 digest a stable JSON representation.
            const payload = JSON.stringify({ body, mediaType, scopeId, scopeKind, targetId, v: 1 });
            let digest: Uint8Array;
            try {
                digest = new Uint8Array(
                    await subtle.digest('SHA-256', new TextEncoder().encode(payload))
                );
            } catch {
                throw new BotError('unavailable');
            }
            const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
            return {
                version: 1,
                evidenceId: 'hanuman:' + hex,
                source: { kind: 'registered-target', targetId },
                retrievedAt: new Date(received).toISOString(),
                status: 'retrieved',
                mediaType,
                bytes,
                excerpt: body.slice(0, end),
                truncated: end < body.length,
                trust: 'untrusted',
                provenance,
            } satisfies HanumanEvidence;
        },
    };
}

export class HanumanBot extends SpecialistBot {
    constructor(options: HanumanBotOptions = {}) {
        const config = botOptions(record(options, ['maxExcerptChars', 'now'], 'invalid-input'));
        super(HANUMAN_BOT_ID, { [HANUMAN_FETCH_URL_CAPABILITY]: retrieval(config) });
    }
}

/** Registers only the bot. Tool availability does not grant permission to use it. */
export function registerHanumanBot(
    registry: BotRegistry,
    options: RegisterHanumanBotOptions
): HanumanBot {
    const value = record(options, ['tools', 'maxExcerptChars', 'now'], 'invalid-input');
    const config = botOptions(value);
    const tools = value.tools as ProtectedToolRegistry | undefined;
    if (typeof tools?.get !== 'function') throw new BotError('invalid-input');
    if (registry.get(HANUMAN_BOT_ID)) throw new BotError('duplicate-bot');
    if (!tools.get(HANUMAN_FETCH_TOOL_ID)) throw new BotError('unavailable');
    const bot = new HanumanBot(config);
    registry.register(bot);
    return bot;
}
