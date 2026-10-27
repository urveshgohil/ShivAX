import { BotError } from '../agents/errors.js';
import { checkPredicate } from '../agents/validation.js';
import type { BotValue } from '../agents/types.js';
import { ProtectedToolRegistry } from '../security/registry.js';
import type { InspectionProvider, InspectionServiceOptions } from './types.js';
import { inspectionPair, inspectionRequest, validateInspectionObservation } from './validation.js';

/** Grants nothing: host policies/approval must also authorize capability and tool. */
export function registerInspectionService(
    tools: ProtectedToolRegistry,
    provider: InspectionProvider,
    options: InspectionServiceOptions
): void {
    if (
        !provider ||
        typeof provider.id !== 'string' ||
        !provider.id.trim() ||
        typeof provider.capture !== 'function' ||
        typeof options?.authorizeURL !== 'function'
    )
        throw new BotError('invalid-input');
    const capture = provider.capture.bind(provider),
        authorize = options.authorizeURL.bind(options),
        reference = options.authorizeReference?.bind(options);
    tools.register({
        id: 'shivax.inspection.capture',
        validateInput: (raw): raw is BotValue => {
            try {
                inspectionRequest(raw);
                return true;
            } catch {
                return false;
            }
        },
        validateOutput: (raw): raw is BotValue => {
            try {
                inspectionPair(raw);
                return true;
            } catch {
                return false;
            }
        },
        async execute(raw, context) {
            const input = inspectionRequest(raw, context.session.scope);
            const urls = [
                input.target,
                ...(input.reference.kind === 'url' ? [input.reference.url] : []),
            ];
            if (!urls.every((url) => checkPredicate(() => authorize(url, context))))
                throw new BotError('tool-not-allowed');
            if (input.reference.kind === 'observation') {
                const supplied = input.reference.observation;
                if (!reference || !checkPredicate(() => reference(supplied, context)))
                    throw new BotError('tool-not-allowed');
            }
            const scan = async (url: string) => {
                context.checkExecution?.();
                context.signal.throwIfAborted();
                let result: unknown;
                try {
                    result = await capture({ url, viewport: input.viewport }, context);
                } catch {
                    throw new BotError('provider-error');
                }
                context.signal.throwIfAborted();
                context.checkExecution?.();
                const observation = validateInspectionObservation(result, context.session.scope);
                if (
                    observation.snapshot.sourceType !== 'url' ||
                    observation.snapshot.viewport.width !== input.viewport.width ||
                    observation.snapshot.viewport.height !== input.viewport.height
                )
                    throw new BotError('invalid-output');
                return observation;
            };
            const baseline =
                input.reference.kind === 'url'
                    ? await scan(input.reference.url)
                    : input.reference.observation;
            const target = await scan(input.target);
            return { baseline, target } as unknown as BotValue;
        },
    });
}
