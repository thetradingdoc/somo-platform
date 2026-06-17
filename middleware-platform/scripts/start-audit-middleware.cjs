#!/usr/bin/env node
'use strict';

const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.AUDIT_MIDDLEWARE = '1';
process.env.DB_PATH = path.join(__dirname, '..', 'middleware-audit.db');
process.env.PORT = '4001';

// Preserve audit port/db if a later dotenv load runs during server bootstrap.
const auditPort = process.env.PORT;
const auditDb = process.env.DB_PATH;

require('../server.js');

process.env.PORT = auditPort;
process.env.DB_PATH = auditDb;
