'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function canWriteDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (_) {}
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function getEnvConfig(packageDir = __dirname) {
  const env = process.env.NODE_ENV || 'development';
  const isProdEnv = env === 'production' || env === 'prod';
  const defaultDbDir = isProdEnv ? '/home' : process.env.HOME || '/home' || packageDir;

  let dbFileName;
  if (process.env.DB_NAME) {
    dbFileName = process.env.DB_NAME;
    console.log(`📁 Using DB_NAME from environment: ${dbFileName}`);
  } else if (isProdEnv) {
    dbFileName = 'middleware-prod.db';
  } else if (env === 'test') {
    dbFileName = 'middleware-test.db';
  } else {
    dbFileName = 'middleware-dev.db';
  }

  return { env, isProdEnv, defaultDbDir, dbFileName, packageDir };
}

function resolveDbPath(config = getEnvConfig()) {
  const { isProdEnv, defaultDbDir, dbFileName, packageDir } = config;

  if (process.env.DB_PATH) {
    return path.resolve(process.cwd(), process.env.DB_PATH);
  }

  if (isProdEnv) {
    return path.join(defaultDbDir, dbFileName);
  }

  const homeCandidate = path.join(defaultDbDir, dbFileName);
  const homeDir = path.dirname(homeCandidate);
  if (canWriteDir(homeDir)) return homeCandidate;

  return path.join(packageDir, 'var', 'db', dbFileName);
}

function warnSplitBrain(dbPath, config = getEnvConfig()) {
  const { dbFileName, packageDir } = config;
  try {
    const legacyCandidates = [
      path.join(packageDir, dbFileName),
      path.join(packageDir, '..', dbFileName),
      path.join(packageDir, '..', 'middleware-test.db')
    ];
    for (const legacy of legacyCandidates) {
      if (legacy === dbPath || !fs.existsSync(legacy)) continue;
      const size = fs.statSync(legacy).size;
      console.warn(
        `⚠️  Split-brain SQLite: ${legacy} (${size} bytes) exists but app uses ${dbPath}. ` +
          'Run scripts/dev/run.sh to archive legacy files into var/db/archive/.'
      );
    }
  } catch (_) {}
}

function ensureDbDirectory(dbPath) {
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!canWriteDir(dir)) {
      console.warn(`⚠️  DB directory not writable: ${dir}`);
    }
  } catch (e) {
    console.warn('⚠️  Could not ensure db directory:', e.message);
  }
}

function openSqliteDatabase(dbPath) {
  ensureDbDirectory(dbPath);
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
  } catch (e) {
    console.warn('⚠️  SQLite journal_mode pragma failed:', e.message);
  }
  const _busyMs = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || '60000', 10);
  const busyTimeoutMs = Number.isFinite(_busyMs) && _busyMs >= 0 ? Math.min(_busyMs, 600000) : 60000;
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  return db;
}

function initPostgresPoolIfConfigured() {
  const usePostgres = !!process.env.POSTGRES_URL;
  if (!usePostgres) {
    return { usePostgres: false, pgPool: null, pgSql: null };
  }
  try {
    const { createPool } = require('../utils/postgres');
    const pgPool = createPool();
    console.log('🗄️  POSTGRES_URL detected – Postgres pool initialized');
    return { usePostgres: true, pgPool, pgSql: pgPool };
  } catch (err) {
    console.error('❌ Failed to initialize Postgres pool:', err.message);
    if (process.env.STAGING === '1' || process.env.SOMO_STAGING === '1') {
      console.warn('⚠️  Staging: continuing SQLite-primary (Postgres mirror disabled until URL fixed)');
      return { usePostgres: false, pgPool: null, pgSql: null };
    }
    process.exit(1);
  }
}

module.exports = {
  canWriteDir,
  getEnvConfig,
  resolveDbPath,
  warnSplitBrain,
  ensureDbDirectory,
  openSqliteDatabase,
  initPostgresPoolIfConfigured
};
