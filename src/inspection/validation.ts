import { snapshotValue } from '../agents/validation.js';
import { BotError } from '../agents/errors.js';
import type { BotValue } from '../agents/types.js';
import { matches } from '../bots/schema.js';
import { normalizeUISnapshot, validateUISnapshot } from '../visual/validation.js';
import {
    inspectionObservationSchema,
    inspectionRequestSchema,
    inspectionViewportSchema,
} from './contracts.js';
import type {
    InspectionObservation,
    InspectionPair,
    InspectionRequest,
    InspectionScope,
    InspectionViewport,
} from './types.js';

export function inspectionJSON(raw: unknown): BotValue {
    return snapshotValue(raw, 1_048_576, 'invalid-input');
}
export function inspectionURL(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length > 8192) throw new BotError('invalid-input');
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new BotError('invalid-input');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new BotError('invalid-input');
    return url.href;
}
export function inspectionViewport(raw: unknown): InspectionViewport {
    const safe = inspectionJSON(raw);
    if (!matches(inspectionViewportSchema, safe)) throw new BotError('invalid-input');
    const view = safe as unknown as InspectionViewport;
    if (!Number.isSafeInteger(view.width) || !Number.isSafeInteger(view.height))
        throw new BotError('invalid-input');
    return view;
}
export function validateInspectionObservation(
    raw: unknown,
    scope?: InspectionScope
): InspectionObservation {
    const safe = inspectionJSON(raw);
    if (!matches(inspectionObservationSchema, safe)) throw new BotError('invalid-input');
    const item = safe as unknown as InspectionObservation;
    validateUISnapshot(item.snapshot);
    if (scope && (item.snapshot.scope.kind !== scope.kind || item.snapshot.scope.id !== scope.id))
        throw new BotError('tool-not-allowed');
    const ids = new Set(item.snapshot.nodes.map((n) => n.id));
    if (
        ids.size > 64 ||
        item.elements.length !== ids.size ||
        new Set(item.elements.map((n) => n.nodeId)).size !== ids.size ||
        item.elements.some((n) => !ids.has(n.nodeId))
    )
        throw new BotError('invalid-input');
    if (
        item.screenshot.status === 'available' &&
        (!Number.isSafeInteger(item.screenshot.width) ||
            !Number.isSafeInteger(item.screenshot.height))
    )
        throw new BotError('invalid-input');
    return inspectionJSON({
        ...item,
        snapshot: normalizeUISnapshot(item.snapshot),
    }) as unknown as InspectionObservation;
}
export function inspectionRequest(raw: unknown, scope?: InspectionScope): InspectionRequest {
    const safe = inspectionJSON(raw);
    if (!matches(inspectionRequestSchema, safe)) throw new BotError('invalid-input');
    const input = safe as unknown as InspectionRequest;
    return Object.freeze({
        target: inspectionURL(input.target),
        viewport: inspectionViewport(input.viewport),
        reference:
            input.reference.kind === 'url'
                ? Object.freeze({ kind: 'url' as const, url: inspectionURL(input.reference.url) })
                : Object.freeze({
                      kind: 'observation' as const,
                      observation: validateInspectionObservation(
                          input.reference.observation,
                          scope
                      ),
                  }),
    });
}
export function inspectionPair(raw: unknown, scope?: InspectionScope): InspectionPair {
    const safe = inspectionJSON(raw) as unknown as InspectionPair;
    if (
        !safe ||
        typeof safe !== 'object' ||
        Object.keys(safe).sort().join(',') !== 'baseline,target'
    )
        throw new BotError('invalid-input');
    const baseline = validateInspectionObservation(safe.baseline, scope),
        target = validateInspectionObservation(safe.target, scope);
    if (
        baseline.snapshot.scope.kind !== target.snapshot.scope.kind ||
        baseline.snapshot.scope.id !== target.snapshot.scope.id
    )
        throw new BotError('tool-not-allowed');
    return Object.freeze({ baseline, target });
}
