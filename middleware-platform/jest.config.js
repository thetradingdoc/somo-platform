module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['js', 'json'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/inci-resolve.test.js',
    '<rootDir>/__tests__/ingredient-conflict-graph.test.js',
    '<rootDir>/__tests__/kelly-routine-reasoning-eval.test.js',
    '<rootDir>/__tests__/retriever-vector-merge.test.js',
    '<rootDir>/__tests__/routine-reasoning-eval.test.js'
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'services/**/*.js'
  ]
};

