import { BotError } from '../agents/errors.js';
import { RudraError } from '../agents/rudra/errors.js';
import { SecurityError } from '../security/errors.js';
import { ModelError } from '../intelligence/errors.js';
import { MemoryError } from '../memory/errors.js';
import { WorkflowError } from '../workflows/errors.js';
export interface SDKDiagnostic {
    readonly code: 'cancelled' | 'timeout' | 'denied' | 'invalid-input' | 'unavailable' | 'failed';
    readonly message: string;
    readonly retryable: boolean;
}
/** UI-safe error projection. Never copy raw messages, payloads, stacks or unknown codes. */
export function toSDKDiagnostic(error: unknown): SDKDiagnostic {
    const known =
        error instanceof BotError ||
        error instanceof RudraError ||
        error instanceof SecurityError ||
        error instanceof ModelError ||
        error instanceof MemoryError ||
        error instanceof WorkflowError;
    const descriptor = known ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    const source = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    const code: SDKDiagnostic['code'] =
        source === 'cancelled'
            ? 'cancelled'
            : source === 'timeout'
              ? 'timeout'
              : [
                      'security-denied',
                      'permission-denied',
                      'approval-denied',
                      'approval-required',
                      'unauthenticated',
                      'expired-session',
                      'revoked-session',
                      'tool-denied',
                      'effect-denied',
                  ].includes(source)
                ? 'denied'
                : ['invalid-input', 'invalid-context', 'invalid-plan', 'invalid-output'].includes(
                        source
                    )
                  ? 'invalid-input'
                  : [
                          'unavailable',
                          'missing-provider',
                          'missing-capability',
                          'missing-model',
                      ].includes(source)
                    ? 'unavailable'
                    : 'failed';
    const messages = {
        cancelled: 'The task was cancelled.',
        timeout: 'The task exceeded its time limit.',
        denied: 'This action requires an authorized session, permission or approval.',
        'invalid-input': 'The request or result does not match the required format.',
        unavailable: 'A required service or capability is unavailable.',
        failed: 'The task could not be completed. Review the host diagnostics.',
    };
    return Object.freeze({ code, message: messages[code], retryable: code === 'unavailable' });
}
