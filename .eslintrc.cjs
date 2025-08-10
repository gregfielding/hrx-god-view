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
    'plugin:import/typescript',
    'prettier'
  ],
  settings: { react: { version: 'detect' } },
  env: { browser: true, es2021: true, node: true },
  rules: {
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


