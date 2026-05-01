import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// ---------------------------------------------------------------------------
// Architectural import rules (FSD layering).
//
// Patterns are defined once and composed into the rule blocks below. ESLint
// flat config does NOT merge rules with the same id across blocks — the
// later block fully replaces the earlier one — so each block must list every
// pattern that should apply to the files it targets.
//
// Two complementary rules are used together:
//   - `no-restricted-imports` covers static `import` statements.
//   - `no-restricted-syntax` covers dynamic `import()` expressions, which
//     `no-restricted-imports` does NOT see.
// ---------------------------------------------------------------------------

const NO_GLOBAL_STORES_LAYER = {
    group: ['@/stores/**', '**/src/stores/**'],
    message:
        'There is no global stores/ layer. Co-locate the store inside the slice that owns it (entities/, features/, or widgets/). See docs/conventions/modular-boundaries.md',
};

const SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS = {
    group: [
        '@/stores/**',
        '@/features/**',
        '@/widgets/**',
        '@/entities/**',
        '@/app/**',
    ],
    message:
        'shared/ is the lowest FSD layer and must not import from higher layers (stores, features, widgets, entities, app). Invert the dependency via an event bus or callback registration in shared/lib instead.',
};

// ---------------------------------------------------------------------------
// Dynamic import() guards. Each entry targets `import('<pattern>')` literals
// via the AST selector and uses the same message as the static counterpart.
// Regex patterns mirror the glob groups above.
// ---------------------------------------------------------------------------

const dynamicImportGuard = (literalRegex, message) => ({
    selector: `ImportExpression > Literal[value=/${literalRegex}/]`,
    message,
});

const NO_DYNAMIC_GLOBAL_STORES = dynamicImportGuard(
    '^@\\/stores\\/',
    NO_GLOBAL_STORES_LAYER.message
);

const NO_DYNAMIC_SHARED_TO_HIGHER = dynamicImportGuard(
    '^@\\/(stores|features|widgets|entities|app)\\/',
    SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS.message
);

const eslintConfig = [
    ...nextCoreWebVitals,
    ...nextTypescript,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
    // Default block: applies to every file. Bans the global stores/ layer
    // for both static and dynamic imports.
    {
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [NO_GLOBAL_STORES_LAYER],
                },
            ],
            'no-restricted-syntax': ['error', NO_DYNAMIC_GLOBAL_STORES],
        },
    },
    // shared/ slice: lowest FSD layer; must not depend on anything above it.
    // Higher layers may depend on shared/, but never the reverse — otherwise
    // circular imports re-emerge and dynamic `import()` workarounds creep
    // back in. See `src/shared/lib/authEvents.ts` for the inversion pattern
    // that replaces such cycles.
    {
        files: ['src/shared/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS],
                },
            ],
            'no-restricted-syntax': ['error', NO_DYNAMIC_SHARED_TO_HIGHER],
        },
    },
];

export default eslintConfig;
