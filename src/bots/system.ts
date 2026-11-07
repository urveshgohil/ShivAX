import { BotRegistry } from '../agents/registry.js';
import { BotError } from '../agents/errors.js';
import { RudraOrchestrator } from '../agents/rudra/orchestrator.js';
import type { RudraHooks } from '../agents/rudra/types.js';
import { Jay } from '../security/jay.js';
import { Vijay, type VijayOptions } from '../security/vijay.js';
import { PermissionPolicyRegistry, ProtectedToolRegistry } from '../security/registry.js';
import { SanjayBot } from './sanjay.js';
import { BrihaspatiBot } from './brihaspati.js';
import { VishwakarmBot } from './vishwakarm.js';
import { ChitraguptBot } from './chitragupt.js';
import { NaradBot } from './narad.js';
import { YudhishthirBot } from './yudhishthir.js';
import { EkalavyBot } from './ekalavy.js';
import { registerSpecialistServices } from './services.js';
import type { SpecialistProviders } from './types.js';
import type { FeedbackStorage, MemoryStorage } from './storage.js';
import type { MemoryStore } from '../memory/types.js';
import { registerMemoryServices, type MemoryServiceOptions } from '../memory/services.js';
import { MemoryTaskLifecycle, type MemoryTaskLifecycleOptions } from '../memory/lifecycle.js';
import { MemoryError } from '../memory/errors.js';
import type { InspectionProvider, InspectionServiceOptions } from '../inspection/types.js';
import { registerInspectionService } from '../inspection/services.js';

export interface SpecialistSystemOptions extends SpecialistProviders {
    readonly inspection?: {
        readonly provider: InspectionProvider;
        readonly options: InspectionServiceOptions;
    };
    readonly memory?: MemoryStorage;
    readonly memoryStore?: MemoryStore;
    readonly memoryServices?: MemoryServiceOptions;
    readonly memoryLifecycle?: MemoryTaskLifecycleOptions;
    readonly feedback?: FeedbackStorage;
    readonly tools?: ProtectedToolRegistry;
    readonly hooks?: Omit<RudraHooks, 'security'>;
    readonly security?: {
        readonly jay: Jay;
        readonly policies: PermissionPolicyRegistry;
        readonly options?: Omit<VijayOptions, 'tools'>;
    };
}
export function createSpecialistBots(providers: SpecialistProviders = {}) {
    return Object.freeze([
        new SanjayBot(providers.vision),
        new BrihaspatiBot(providers.reasoning),
        new VishwakarmBot(providers.code),
        new ChitraguptBot(),
        new NaradBot(),
        new YudhishthirBot(providers.review),
        new EkalavyBot(),
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
    if (options.inspection)
        registerInspectionService(tools, options.inspection.provider, options.inspection.options);
    if (options.memoryStore)
        registerMemoryServices(tools, options.memoryStore, options.memoryServices);
    const bots = registerSpecialistBots(registry, options);
    const security = options.security
        ? new Vijay(options.security.jay, options.security.policies, {
              ...options.security.options,
              tools,
          })
        : undefined;
    if (options.memoryLifecycle && !security) throw new MemoryError('invalid-input');
    const lifecycle = options.memoryLifecycle
        ? new MemoryTaskLifecycle(security!, options.memoryLifecycle)
        : options.hooks?.memory;
    const rudra = new RudraOrchestrator(registry, {
        ...options.hooks,
        security,
        memory: lifecycle,
    });
    return Object.freeze({ bots, registry, tools, security, rudra, lifecycle });
}
