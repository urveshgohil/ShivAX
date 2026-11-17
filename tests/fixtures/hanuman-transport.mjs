export const peer = Object.freeze({ family: 4, address: '8.8.8.8' });
export const defer = () => Promise.withResolvers();

export function mockResponse(overrides = {}) {
    return {
        status: 200,
        contentType: 'text/plain',
        contentLength: null,
        contentEncoding: null,
        peer,
        body: (async function* () {
            yield new TextEncoder().encode('hello');
        })(),
        ...overrides,
    };
}
