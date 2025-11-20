const postgres = require('postgres');
const crypto = require('crypto');

let poolInstance = null;

function createPool(connectionString) {
  const url = connectionString || process.env.POSTGRES_URL;

  if (!url) {
    throw new Error('POSTGRES_URL is not defined');
  }

  if (!poolInstance) {
    poolInstance = postgres(url, {
      max: Number(process.env.POSTGRES_POOL_SIZE || 10),
      idle_timeout: 20,
      connect_timeout: 30,
      ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined
    });
  }

  return poolInstance;
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

module.exports = {
  createPool,
  sql: () => createPool(),
  generateId
};

