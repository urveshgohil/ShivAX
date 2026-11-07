// Development-only peer resolution for the separately packaged, uninstalled adapter.
export function resolve(specifier, context, nextResolve) {
    if (specifier === 'shivax' && context.parentURL?.includes('/adapters/inspectra/'))
        return {
            url: new URL('../../dist/index.esm.js', import.meta.url).href,
            shortCircuit: true,
        };
    return nextResolve(specifier, context);
}
