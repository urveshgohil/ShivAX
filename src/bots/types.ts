import type { BotSignal, BotValue, SecurityContext } from '../agents/types.js';

export interface SpecialistProviderContext {
    readonly taskId: string;
    readonly sessionId: string;
    readonly scope: SecurityContext['scope'];
    readonly signal: BotSignal;
}
export interface VisionImage {
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly base64: string;
}
export interface VisionModelAdapter {
    readonly id: string;
    analyze(
        input: { readonly image: VisionImage; readonly observations?: BotValue },
        context: SpecialistProviderContext
    ): unknown | Promise<unknown>;
}
export interface ReasoningProvider {
    readonly id: string;
    decide(input: BotValue, context: SpecialistProviderContext): unknown | Promise<unknown>;
    plan?(input: BotValue, context: SpecialistProviderContext): unknown | Promise<unknown>;
}
export interface CodeProvider {
    readonly id: string;
    suggest(input: BotValue, context: SpecialistProviderContext): unknown | Promise<unknown>;
}
export interface ReviewProvider {
    readonly id: string;
    review(input: BotValue, context: SpecialistProviderContext): unknown | Promise<unknown>;
}
export interface SpecialistProviders {
    readonly vision?: VisionModelAdapter;
    readonly reasoning?: ReasoningProvider;
    readonly code?: CodeProvider;
    readonly review?: ReviewProvider;
}
