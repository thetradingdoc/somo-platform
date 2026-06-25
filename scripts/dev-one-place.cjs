#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const procs = [];
let shuttingDown = false;

const devEnv = {
  ...process.env,
  LOCAL_DEV_ROOT: process.env.LOCAL_DEV_ROOT || 'health'
};

function prefixedPipe(stream, prefix) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = String(chunk).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      process.stdout.write(`${prefix} ${line}\n`);
    }
  });
}

function start(name, args) {
  const child = spawn('npm', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: devEnv,
    shell: true
  });
  procs.push(child);
  prefixedPipe(child.stdout, `[${name}]`);
  prefixedPipe(child.stderr, `[${name}]`);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      const why = signal ? `signal ${signal}` : `exit ${code}`;
      console.error(`[dev:one-place] ${name} stopped (${why}). Shutting down.`);
      shutdown(typeof code === 'number' ? code : 1);
    }
  });
  return child;
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 350);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev:one-place] Starting middleware API on :4000');
console.log('[dev:one-place] Health MVP: http://localhost:4000/ → /health-video.html');
console.log('[dev:one-place] Provider portal: http://localhost:4000/login');

start('api', ['start', '--prefix', 'middleware-platform']);
