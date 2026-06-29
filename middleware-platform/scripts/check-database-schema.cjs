#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.js');
const content = fs.readFileSync(dbPath, 'utf8');
const matches = content.match(/CREATE TABLE/gi) || [];

if (matches.length > 0 && process.env.ALLOW_DATABASE_CREATE_TABLE !== '1') {
  console.error(`database.js contains ${matches.length} CREATE TABLE — use migrations/ instead`);
  process.exit(1);
}

console.log('check-database-schema: OK (no CREATE TABLE in database.js)');
