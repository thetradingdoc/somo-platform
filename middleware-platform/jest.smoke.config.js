/** Opt-in HTTP smokes (requires RUN_PAYOR_HTTP_SMOKE=1 in the test file). */
module.exports = {
  ...require('./jest.config.js'),
  roots: ['<rootDir>/__tests__/smoke'],
  testPathIgnorePatterns: ['/node_modules/'],
};
