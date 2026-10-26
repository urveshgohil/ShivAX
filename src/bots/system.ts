import { BotRegistry } from '../agents/registry.js';
import { BotError } from '../agents/errors.js';
import { RudraOrchestrator } from '../agents/rudra/orchestrator.js';
import type { RudraHooks } from '../agents/rudra/types.js';
import { Jaya } from '../security/jaya.js';
import { Vijaya, type VijayaOptions } from '../security/vijaya.js';
import { PermissionPolicyRegistry, ProtectedToolRegistry } from '../security/registry.js';
import { SanjayaBot } from './sanjaya.js';
import { BrihaspatiBot } from './brihaspati.js';
import { VishwakarmaBot } from './vishwakarma.js';
import { ChitraguptaBot } from './chitragupta.js';
import { HanumanBot } from './hanuman.js';
import { YudhishthiraBot } from './yudhishthira.js';
import { EkalavyaBot } from './ekalavya.js';
import { registerSpecialistServices } from './services.js';
import type { SpecialistProviders } from './types.js';
import type { FeedbackStorage, MemoryStorage } from './storage.js';

export interface SpecialistSystemOptions extends SpecialistProviders {
    readonly memory?: MemoryStorage;
    readonly feedback?: FeedbackStorage;
    readonly tools?: ProtectedToolRegistry;
    readonly hooks?: Omit<RudraHooks, 'security'>;
    readonly security?: {
        readonly jaya: Jaya;
        readonly policies: PermissionPolicyRegistry;
        readonly options?: Omit<VijayaOptions, 'tools'>;
    };
}
export function createSpecialistBots(providers: SpecialistProviders = {}) {
    return Object.freeze([
        new SanjayaBot(providers.vision),
        new BrihaspatiBot(providers.reasoning),
        new VishwakarmaBot(providers.code),
        new ChitraguptaBot(),
        new HanumanBot(),
        new YudhishthiraBot(providers.review),
        new EkalavyaBot(),
    ]);
}
export function registerSpecialistBots(registry: BotRegistry, providers: SpecialistProviders = {}) {
    const bots = createSpecialistBots(providers);
    if (bots.some((bot) => registry.get(bot.id))) throw new BotError('duplicate-bot');
    bots.forEach((bot) => registry.register(bot));
    return bots;
}
/** Explicit instance composition. Registers all seven bots, with no global singleton or implicit grants. */
export function createSpecialistSystem(options: SpecialistSystemOptions = {}) {
    const registry = new BotRegistry(),
        tools = options.tools ?? new ProtectedToolRegistry();
    registerSpecialistServices(tools, options);
    const bots = registerSpecialistBots(registry, options);
    const security = options.security
        ? new Vijaya(options.security.jaya, options.security.policies, {
              ...options.security.options,
              tools,
          })
        : undefined;
    const rudra = new RudraOrchestrator(registry, { ...options.hooks, security });
    return Object.freeze({ bots, registry, tools, security, rudra });
}
