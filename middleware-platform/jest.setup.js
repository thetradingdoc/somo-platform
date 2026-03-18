// Ensure tests never touch a real SQLite file.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

