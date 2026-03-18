module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['js', 'json'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'services/**/*.js'
  ]
};

