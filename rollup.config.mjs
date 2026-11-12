const entries = ['core', 'rudra', 'bots', 'security', 'models', 'memory', 'integrations', 'learning', 'learning-node', 'diagnostics'];
const input = { index: 'dist/index.js', ...Object.fromEntries(entries.map(name => [name, `dist/sdk/${name}.js`])), inspectra: 'adapters/inspectra/index.mjs', licensing: 'dist/licensing/index.js' };
// Shared chunks preserve class identity across root and subpath imports.
const external = (id) =>
    id === 'shivax' ||
    id.startsWith('shivax/') ||
    id === 'inspectra-engine' ||
    id.startsWith('inspectra-engine/') ||
    // Node built-ins are used only by the Node-only learning-node entry and its worker (S03).
    id.startsWith('node:');
const library = ['esm', 'cjs'].map(format => ({
    input,
    external,
    output: {
        dir: 'dist', format,
        entryFileNames: ({ name }) => name === 'index' ? (format === 'esm' ? 'index.esm.js' : 'index.cjs') :
            name === 'licensing' ? (format === 'esm' ? 'licensing/index.esm.js' : 'licensing/index.cjs') :
                `sdk/${name}.${format === 'esm' ? 'esm.js' : 'cjs'}`,
        chunkFileNames: `chunks/${format}/[name]-[hash].${format === 'esm' ? 'js' : 'cjs'}`,
    },
}));
// S03: the training worker is one self-contained ES module that both the ESM and CJS builds of
// shivax/learning/node start with new Worker(new URL('./learning-worker.mjs', import.meta.url)).
const worker = {
    input: 'dist/learning/training-worker.js',
    external,
    output: { file: 'dist/sdk/learning-worker.mjs', format: 'esm' },
};
export default [...library, worker];
