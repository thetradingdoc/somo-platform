module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  testTimeout: 30000,
  forceExit: true,
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['js', 'json'],
  // Opt-in HTTP smoke — not part of default CI Jest. See __tests__/README.md. Playwright specs live under e2e/*.spec.cjs.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/smoke/'
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  globalTeardown: '<rootDir>/jest.global-teardown.js',
  collectCoverageFrom: [
    'services/**/*.js'
  ]
};
