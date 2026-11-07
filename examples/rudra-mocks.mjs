/** Explicit arithmetic test doubles, not reasoning models or production specialists. */
export function createMockReasoningBot() {
    return {
        id: 'mock-reasoning', capabilities: [{ id: 'mock.reason', description: 'Sum finite numbers' }],
        validateInput: input => Array.isArray(input.data) && input.data.every(Number.isFinite),
        validateOutput: data => data !== null && typeof data === 'object' &&
            Array.isArray(data.numbers) && data.numbers.every(Number.isFinite) && Number.isFinite(data.total),
        execute(input, context) {
            return { taskId: context.task.taskId, botId: this.id, status: 'completed',
                data: { numbers: input.data, total: input.data.reduce((sum, value) => sum + value, 0) } };
        },
    };
}
export function createMockReviewBot() {
    return {
        id: 'mock-review', capabilities: [{ id: 'mock.review', description: 'Check the proposed sum' }],
        validateInput: input => input.data !== null && typeof input.data === 'object' &&
            Array.isArray(input.data.numbers) && input.data.numbers.every(Number.isFinite) && Number.isFinite(input.data.total),
        validateOutput: data => data !== null && typeof data === 'object' &&
            typeof data.verified === 'boolean' && Number.isFinite(data.total),
        execute(input, context) {
            const actual = input.data.numbers.reduce((sum, value) => sum + value, 0);
            return { taskId: context.task.taskId, botId: this.id, status: 'completed',
                data: { verified: actual === input.data.total, total: input.data.total } };
        },
    };
}
