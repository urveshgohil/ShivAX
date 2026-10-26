import { ProtectedToolRegistry } from '../security/registry.js';
import { SecurityError } from '../security/errors.js';
import type { AuthenticatedIdentity, ProtectedTool } from '../security/types.js';
import type { BotValue } from '../agents/types.js';
import type { FeedbackStorage, MemoryNamespace, MemoryStorage } from './storage.js';
import {
    memoryReadInput,
    memoryReadOutput,
    memoryWriteInput,
    memoryWriteOutput,
} from './chitragupta.js';
import { feedbackAckSchema, feedbackRecordSchema } from './ekalavya.js';
import { matches } from './schema.js';

function namespace(identity: AuthenticatedIdentity): MemoryNamespace {
    return Object.freeze({
        principalId: identity.principal.id,
        issuer: identity.principal.issuer,
        sessionId: identity.session.id,
        scopeKind: identity.session.scope.kind,
        scopeId: identity.session.scope.id,
    });
}
/** Registers implementations only. It never grants permissions or adds authorization policies. */
export function registerSpecialistServices(
    tools: ProtectedToolRegistry,
    services: { memory?: MemoryStorage; feedback?: FeedbackStorage }
): void {
    const definitions: ProtectedTool[] = [];
    const memory = services.memory,
        feedback = services.feedback;
    if (memory) {
        definitions.push({
            id: 'shivax.memory.read',
            validateInput: (input): input is BotValue => matches(memoryReadInput, input),
            validateOutput: (output): output is BotValue => matches(memoryReadOutput, output),
            execute: (input, context) =>
                memory.read(namespace(context), (input as { key: string }).key, context.signal) as
                    BotValue | Promise<BotValue>,
        });
        definitions.push({
            id: 'shivax.memory.write',
            validateInput: (input): input is BotValue => matches(memoryWriteInput, input),
            validateOutput: (output): output is BotValue => matches(memoryWriteOutput, output),
            execute: (input, context) => {
                const data = input as { key: string; value: BotValue };
                return memory.write(namespace(context), data.key, data.value, context.signal);
            },
        });
    }
    if (feedback)
        definitions.push({
            id: 'shivax.feedback.append',
            validateInput: (input): input is BotValue => matches(feedbackRecordSchema, input),
            validateOutput: (output): output is BotValue => matches(feedbackAckSchema, output),
            execute: (input, context) => feedback.append(namespace(context), input, context.signal),
        });
    if (definitions.some((tool) => tools.get(tool.id))) throw new SecurityError('duplicate-tool');
    definitions.forEach((tool) => tools.register(tool));
}
