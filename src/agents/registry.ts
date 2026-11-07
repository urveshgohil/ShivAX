import { BotError } from './errors.js';
import { BotEventEmitter } from './events.js';
import { identifier, snapshotBot } from './validation.js';
import type { Bot, BotValue, Capability } from './types.js';

/** No global instances, automatic discovery, capability routing or bot execution. */
export class BotRegistry {
    private readonly bots = new Map<string, Bot>();
    constructor(public readonly events = new BotEventEmitter()) {}
    register<I extends BotValue, O extends BotValue>(bot: Bot<I, O>): this {
        const snapshot = snapshotBot(bot);
        if (this.bots.has(snapshot.id)) throw new BotError('duplicate-bot');
        this.bots.set(snapshot.id, snapshot);
        this.events.emit('bot:registered', { botId: snapshot.id });
        return this;
    }
    unregister(id: string): boolean {
        identifier(id, 'invalid-bot');
        if (!this.bots.delete(id)) return false;
        this.events.emit('bot:unregistered', { botId: id });
        return true;
    }
    get(id: string): Bot | undefined {
        identifier(id, 'invalid-bot');
        return this.bots.get(id);
    }
    list(): readonly Bot[] {
        return Object.freeze([...this.bots.values()]);
    }
    findByCapability(id: string): readonly Bot[] {
        identifier(id, 'invalid-input');
        return Object.freeze(
            [...this.bots.values()].filter((bot) =>
                bot.capabilities.some((capability) => capability.id === id)
            )
        );
    }
    listCapabilities(): readonly Capability[] {
        const capabilities = new Map<string, Capability>();
        for (const bot of this.bots.values())
            for (const capability of bot.capabilities) {
                if (!capabilities.has(capability.id)) capabilities.set(capability.id, capability);
            }
        return Object.freeze([...capabilities.values()]);
    }
}
