// TypeScript is checked by tsc; lint JavaScript tooling without compiler API dependencies.
export default [
    { ignores: ['dist/**', 'node_modules/**', '.pnpm-store/**', '.husky/**'] },
    {
        files: ['**/*.mjs'],
        rules: {
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-debugger': 'error',
            'no-duplicate-imports': 'error',
        },
    },
];
