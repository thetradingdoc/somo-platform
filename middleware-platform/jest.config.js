module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['js', 'json'],
  // Plain `node __tests__/manual/…` harnesses and opt-in HTTP smoke — not part of default CI Jest.
  // See __tests__/README.md. Playwright specs live under e2e/*.spec.cjs.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/manual/',
    '<rootDir>/__tests__/smoke/'
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'services/**/*.js'
  ]
};
