import { BotRegistry } from 'shivax/rudra';
import { createSpecialistBots } from 'shivax/bots';
const registry = new BotRegistry();
createSpecialistBots().forEach(bot => registry.register(bot));
console.log(registry.list().map(bot => bot.id));
