// Ensure tests never touch a real SQLite file.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

// Load middleware-platform/.env so local keys (e.g. ANTHROPIC_API_KEY) are visible to Jest.
// Does not override variables already set in the shell / CI.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

