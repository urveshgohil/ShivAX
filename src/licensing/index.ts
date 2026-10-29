import type { AuthenticatedIdentity } from '../security/types.js';
import type { Jay } from '../security/jay.js';
import type { BotSignal, TaskContext } from '../agents/types.js';
import { record, identifier, snapshotValue } from '../agents/validation.js';
export interface LicenseVerificationRequest extends AuthenticatedIdentity {
    readonly productId: string;
    readonly feature: string;
    readonly signal: BotSignal;
}
/** Server implementation must verify entitlement with its provider; browser claims are not evidence. */
export interface ServerLicenseVerifier {
    verify(request: LicenseVerificationRequest): unknown | Promise<unknown>;
}
export interface VerifiedEntitlement {
    readonly version: 1;
    readonly productId: string;
    readonly subject: { readonly id: string; readonly issuer: string };
    readonly scope: { readonly kind: 'personal' | 'company'; readonly id: string };
    readonly features: readonly string[];
    readonly expiresAt: number;
}
export class LicenseError extends Error {
    constructor() {
        super('The server could not verify the required license entitlement.');
        this.name = 'LicenseError';
    }
}
/** Server/desktop host only. No API keys, license keys, fetch implementation or local permission override. */
export class ServerLicenseGate {
    readonly #verify: ServerLicenseVerifier['verify'];
    constructor(
        private readonly jay: Jay,
        verifier: ServerLicenseVerifier,
        private readonly productId: string,
        private readonly now: () => number = Date.now
    ) {
        identifier(productId, 'invalid-input');
        this.#verify = verifier.verify.bind(verifier);
    }
    async require(context: TaskContext, feature: string): Promise<VerifiedEntitlement> {
        try {
            identifier(feature, 'invalid-input');
            const identity = await this.jay.verify(context, context.signal);
            const raw = await this.#verify(
                Object.freeze({
                    ...identity,
                    productId: this.productId,
                    feature,
                    signal: context.signal,
                })
            );
            context.signal.throwIfAborted();
            await this.jay.verify(context, context.signal);
            const value = record(
                snapshotValue(raw, 16384, 'invalid-input'),
                ['version', 'productId', 'subject', 'scope', 'features', 'expiresAt'],
                'invalid-input'
            );
            const subject = record(value.subject, ['id', 'issuer'], 'invalid-input');
            const scope = record(value.scope, ['kind', 'id'], 'invalid-input');
            const now = this.now();
            if (
                value.version !== 1 ||
                value.productId !== this.productId ||
                subject.id !== identity.principal.id ||
                subject.issuer !== identity.principal.issuer ||
                scope.id !== identity.session.scope.id ||
                scope.kind !== identity.session.scope.kind ||
                !Array.isArray(value.features) ||
                value.features.length > 128 ||
                !value.features.includes(feature) ||
                !Number.isFinite(now) ||
                !Number.isSafeInteger(value.expiresAt) ||
                (value.expiresAt as number) <= now
            )
                throw new LicenseError();
            value.features.forEach((v) => identifier(v, 'invalid-input'));
            context.signal.throwIfAborted();
            return value as unknown as VerifiedEntitlement;
        } catch {
            throw new LicenseError();
        }
    }
}
