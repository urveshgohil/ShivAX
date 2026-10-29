const entries = ['core', 'rudra', 'bots', 'security', 'models', 'memory', 'integrations', 'learning', 'diagnostics'];
const input = { index: 'dist/index.js', ...Object.fromEntries(entries.map(name => [name, `dist/sdk/${name}.js`])), inspectra: 'adapters/inspectra/index.mjs', licensing: 'dist/licensing/index.js' };
// Shared chunks preserve class identity across root and subpath imports.
export default ['esm', 'cjs'].map(format => ({
    input,
    external: ['shivax', 'inspectra-engine'],
    output: {
        dir: 'dist', format,
        entryFileNames: ({ name }) => name === 'index' ? (format === 'esm' ? 'index.esm.js' : 'index.cjs') :
            name === 'licensing' ? (format === 'esm' ? 'licensing/index.esm.js' : 'licensing/index.cjs') :
            `sdk/${name}.${format === 'esm' ? 'esm.js' : 'cjs'}`,
        chunkFileNames: `chunks/${format}/[name]-[hash].${format === 'esm' ? 'js' : 'cjs'}`,
    },
}));
