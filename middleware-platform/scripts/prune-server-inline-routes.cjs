#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
const lines = fs.readFileSync(serverPath, 'utf8').split('\n');

const ranges = [
  [4490, 4679],
  [3708, 4466],
  [2488, 3383],
  [2245, 2486],
  [1966, 2087],
  [22736, 23520],
  [21372, 21390],
  [19118, 19254],
  [18599, 19023],
].sort((a, b) => b[0] - a[0]);

for (const [start, end] of ranges) {
  lines.splice(start - 1, end - start + 1);
}

fs.writeFileSync(serverPath, `${lines.join('\n')}\n`);
console.log('Pruned inline routes from server.js; new line count:', lines.length);
