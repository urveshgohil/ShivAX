export default {
    input: 'dist/index.js',
    output: [
        { file: 'dist/index.cjs', format: 'cjs' },
        { file: 'dist/index.esm.js', format: 'esm' },
    ],
};
