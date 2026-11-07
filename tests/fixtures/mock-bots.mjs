/** Explicit test doubles, not AI implementations or production specialist bots. */
export function createEchoBot(id = 'mock.echo') {
    return {
        id, capabilities: [{ id: 'mock.echo', description: 'Uppercase supplied test text.' }], calls: 0,
        validateInput(input) { return input.capability === 'mock.echo' && typeof input.data === 'string'; },
        validateOutput(data) { return typeof data === 'string'; },
        execute(input, context) {
            this.calls++;
            context.task.signal.throwIfAborted();
            return { taskId: context.task.taskId, botId: id, status: 'completed', data: input.data.toUpperCase() };
        },
    };
}

export function createSumBot(id = 'mock.sum') {
    return {
        id, capabilities: [{ id: 'mock.sum', description: 'Sum supplied finite test numbers.' }], calls: 0,
        validateInput(input) {
            return input.capability === 'mock.sum' && Array.isArray(input.data) && input.data.length > 0 &&
                input.data.length <= 16 && input.data.every(value => typeof value === 'number' && Number.isFinite(value));
        },
        validateOutput(data) { return typeof data === 'number' && Number.isFinite(data); },
        async execute(input, context) {
            this.calls++;
            context.task.signal.throwIfAborted();
            return { taskId: context.task.taskId, botId: id, status: 'completed', data: input.data.reduce((a, b) => a + b, 0) };
        },
    };
}
