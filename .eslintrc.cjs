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
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-empty-function': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/no-unescaped-entities': 'off',
    'react/jsx-key': 'warn',
    'import/order': ['warn', { 'newlines-between': 'always' }],
    'react/no-danger': 'warn',
    'react/forbid-component-props': ['warn', { forbid: [{ propName: 'style', message: 'Use theme tokens and sx prop or styled components' }] }],
    'no-empty': ['warn', { allowEmptyCatch: true }]
  }
};


