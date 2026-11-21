/** @type {import('jest').Config} */
const shared = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['@swc/jest', { module: { type: 'commonjs' } }],
  },
  // Some Fastify dependencies (cookie, content-disposition) ship ES modules only.
  // Jest runs CommonJS, so swc compiles node_modules too. It is fast enough that this costs about a second.
  transformIgnorePatterns: [],
};

module.exports = {
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.test.ts'] },
    { ...shared, displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.ts'] },
  ],
};
