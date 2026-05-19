import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const eslintConfig = [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{js,ts,tsx}'],
        languageOptions: {
            parser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true },
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
                React: 'readonly',
            },
        },
        rules: {
            'no-constant-condition': 'error',
            'no-dupe-else-if': 'error',
            'no-dupe-args': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-duplicate-imports': 'error',
            'no-ex-assign': 'error',
            'no-fallthrough': 'warn',
            'no-func-assign': 'warn',
            'no-import-assign': 'error',
            'no-irregular-whitespace': [
                'error',
                {
                    skipStrings: true,
                    skipComments: true,
                    skipTemplates: true,
                },
            ],
            'no-self-assign': 'warn',
            'no-self-compare': 'warn',
            'no-template-curly-in-string': 'warn',
            'no-unmodified-loop-condition': 'warn',
            'no-unreachable': 'error',
            'no-unreachable-loop': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            eqeqeq: ['error', 'always'],
            'no-console': 'off',
            'prefer-const': 'error',
            'no-with': 'error',
            'no-void': 'error',
            'no-var': 'error',
            'no-eval': 'error',
            'no-async-promise-executor': 'error',
            'arrow-spacing': [
                'error',
                {
                    before: true,
                    after: true,
                },
            ],
            'block-spacing': 'error',
            'brace-style': ['error', 'stroustrup'],
            'comma-dangle': ['error', 'only-multiline'],
            'comma-spacing': 'error',
            'eol-last': 'error',
            semi: ['error', 'always'],
            quotes: [
                'error',
                'single',
                {
                    allowTemplateLiterals: true,
                },
            ],
            'no-extra-semi': 'error',
            'object-curly-spacing': ['error', 'always'],
            indent: ['error', 4],
            'key-spacing': ['error', { afterColon: true }],
            'keyword-spacing': ['error', { before: true, after: true }],
            'space-before-blocks': 'error',
        },
    },
    {
        ignores: ['node_modules/', '.next/', 'out/'],
    },
];

export default eslintConfig;
