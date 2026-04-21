#!/usr/bin/env node
/**
 * Path B from todos §13: CMS pipeline without re-importing NPPES bulk, directory, or endpoints.
 * Forwards extra argv to run-payor-cms-track-pipeline.cjs (e.g. --skip-migrate --skip-pull).
 *
 *   npm run run:payor:nppes-path-b-pipeline -- --skip-migrate --skip-pull
 */
'use strict';

require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const extra = process.argv.slice(2);
const base = ['--skip-nppes-bulk', '--skip-directory', '--skip-endpoints'];
const args = ['run', 'run:payor:cms-pipeline', '--', ...base, ...extra];
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npmCmd, args, { cwd: root, stdio: 'inherit', shell: false });
process.exit(r.status == null ? 1 : r.status);
