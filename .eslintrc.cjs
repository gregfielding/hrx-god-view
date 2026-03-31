module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import', 'unused-imports'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
    'prettier'
  ],
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      // Let import/no-unresolved resolve TS/TSX and CSS imports used by CRA
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts', '.json', '.css'],
      },
    },
  },
  env: { browser: true, es2021: true, node: true },
  rules: {
    // In CRA apps we intentionally import non-JS assets (CSS, images). The node resolver
    // can still be flaky depending on environment; don't block builds on this.
    'import/no-unresolved': 'off',
    // These commonly false-positive in TS-heavy CRA apps unless the full TS resolver stack
    // is installed and perfectly aligned with react-scripts' internal ESLint config.
    'import/named': 'off',
    'import/namespace': 'off',
    'import/default': 'off',
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    'unused-imports/no-unused-imports': 'warn',
    // Avoid duplicate warnings with @typescript-eslint/no-unused-vars for imports.
    '@typescript-eslint/no-unused-vars': 'off',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    // Legacy codebase: thousands of intentional `any` bridges; re-enable as "warn" when cleaning a folder.
    '@typescript-eslint/no-explicit-any': 'off',
    // Style-only; very noisy in this repo and does not affect runtime.
    'import/order': 'off',
    'import/no-duplicates': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/no-unescaped-entities': 'off',
    'react/jsx-key': 'warn',
    'react/no-danger': 'warn',
    'react/forbid-component-props': ['warn', { forbid: [{ propName: 'style', message: 'Use theme tokens and sx prop or styled components' }] }],
    'no-empty': ['warn', { allowEmptyCatch: true }]
  },
  overrides: [
    {
      files: ['src/pages/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector: "MemberExpression[property.name='headerEmploymentStatus']",
            message:
              'Use employmentHeaderState (EmploymentV2HeaderState) for header or top-level employment chips. headerEmploymentStatus is frozen — see deriveEmploymentHeaderState.ts and employmentV2Types.ts.',
          },
        ],
      },
    },
  ],
};


