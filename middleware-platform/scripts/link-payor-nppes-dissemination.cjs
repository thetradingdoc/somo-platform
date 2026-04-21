#!/usr/bin/env node
'use strict';

/**
 * Link an extracted NPPES dissemination folder into the canonical payor data tree so
 * imports do not depend on ~/Downloads paths.
 *
 * Usage (from middleware-platform/):
 *   node scripts/link-payor-nppes-dissemination.cjs /path/to/NPPES_Data_Dissemination_April_2026_V2
 *   npm run setup:payor-data-sources:link-nppes -- /path/to/NPPES_Data_Dissemination_April_2026_V2
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPayorDataSourcesRoot, disseminationDirNameOk } = require('./payor-data-sources.cjs');

process.chdir(path.join(__dirname, '..'));

function getArg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : null;
}

function inferDirectoryTarget() {
  const fromFlag = getArg('target');
  if (fromFlag) {
    return path.isAbsolute(fromFlag) ? fromFlag : path.resolve(process.cwd(), fromFlag);
  }
  const rest = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  for (let i = rest.length - 1; i >= 0; i--) {
    const p = path.isAbsolute(rest[i]) ? rest[i] : path.resolve(process.cwd(), rest[i]);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch (_) {}
  }
  return null;
}

const targetArg = inferDirectoryTarget();
if (!targetArg) {
  console.error(
    'Usage: node scripts/link-payor-nppes-dissemination.cjs /absolute/or/relative/path/to/NPPES_Data_Dissemination_*_V2\n' +
      '   or: --target=/path/to/NPPES_Data_Dissemination_April_2026_V2'
  );
  process.exit(1);
}

const resolvedTarget = targetArg;
if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isDirectory()) {
  console.error(`Not a directory: ${resolvedTarget}`);
  process.exit(1);
}

const base = path.basename(resolvedTarget.replace(/\/+$/, ''));
if (!disseminationDirNameOk(base)) {
  console.warn(
    `Warning: folder name "${base}" does not match NPPES_Data_Dissemination_*_V2; link will still be created.`
  );
}

const nppesDir = path.join(getPayorDataSourcesRoot(), 'nppes');
fs.mkdirSync(nppesDir, { recursive: true });

const linkPath = path.join(nppesDir, base);
if (fs.existsSync(linkPath)) {
  const st = fs.lstatSync(linkPath);
  if (st.isSymbolicLink()) {
    fs.unlinkSync(linkPath);
  } else {
    console.error(`Refusing to overwrite existing path (not a symlink): ${linkPath}`);
    process.exit(1);
  }
}

fs.symlinkSync(resolvedTarget, linkPath, 'dir');
console.log(
  JSON.stringify(
    {
      event: 'payor_nppes_dissemination_linked',
      link: linkPath,
      target: resolvedTarget,
      payor_data_sources_root: getPayorDataSourcesRoot()
    },
    null,
    2
  )
);
