/**
 * Functions test runner (2026-08-29, interview review F5): the suite was
 * unrunnable — no jest config, so babel-jest choked on `import type`
 * syntax and every TS test failed at parse. ts-jest against the existing
 * tsconfig makes the tests real again.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Keep unit tests hermetic — no emulator, no network.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
};
