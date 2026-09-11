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
  // Initialize a dummy firebase-admin app so modules that call
  // `admin.firestore()` at import time can be loaded without the emulator.
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Keep unit tests hermetic — no emulator, no network.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  // Memory cap (2026-09-11): uncapped, jest starts cores − 1 workers (13 on
  // Greg's 14-core, 24 GB Mac) and each ts-jest worker holds ~2–3 GB — one
  // run reached ~31 GB and filled swap. Two workers, each restarted once it
  // passes 1 GB. See docs/claude/feedback_jest_worker_memory.md.
  maxWorkers: 2,
  workerIdleMemoryLimit: '1GB',
};
