#!/usr/bin/env node
'use strict';

/**
 * Single root for payor-related raw inputs (NPPES, future Office Ally / Inovalon drops).
 *
 * Layout (recommended):
 *   data/payor-sources/
 *     nppes/
 *       NPPES_Data_Dissemination_<Month>_<Year>_V2/   # extracted dissemination, or symlink to it
 *         npidata_pfile_*.csv
 *       NPPES_Data_Dissemination_*_V2.zip             # optional; smaller than extracted CSV
 *     office-ally/
 *     inovalon/
 *
 * Env:
 *   PAYOR_DATA_SOURCES_ROOT  — absolute or cwd-relative; default ./data/payor-sources
 *   NPPES_DISSEMINATION_DIR  — override path to extracted dissemination folder (contains npidata_pfile_*.csv)
 */

const fs = require('fs');
const path = require('path');

function getPayorDataSourcesRoot(cwd = process.cwd()) {
  const env = String(process.env.PAYOR_DATA_SOURCES_ROOT || '').trim();
  if (env) return path.isAbsolute(env) ? env : path.resolve(cwd, env);
  return path.join(cwd, 'data', 'payor-sources');
}

function listEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

/** readdir Dirent: symlinks to dirs often report isDirectory() === false; follow one level. */
function entryIsDirectory(fullPath, ent) {
  if (ent.isDirectory()) return true;
  if (typeof ent.isSymbolicLink === 'function' && ent.isSymbolicLink()) {
    try {
      return fs.statSync(fullPath).isDirectory();
    } catch (_) {
      return false;
    }
  }
  return false;
}

function disseminationDirNameOk(name) {
  return /^NPPES_Data_Dissemination_.*_V2$/i.test(String(name || '').trim());
}

/**
 * Directory that contains npidata_pfile_*.csv (extracted CMS package).
 * @returns {string|null}
 */
function resolveNppesDisseminationDir(cwd = process.cwd()) {
  const explicit = String(process.env.NPPES_DISSEMINATION_DIR || '').trim();
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    if (!fs.existsSync(abs)) {
      throw new Error(`NPPES_DISSEMINATION_DIR does not exist: ${abs}`);
    }
    return abs;
  }

  const nppesRoot = path.join(getPayorDataSourcesRoot(cwd), 'nppes');
  let bestDir = null;
  let bestSize = -1;
  for (const ent of listEntries(nppesRoot)) {
    const full = path.join(nppesRoot, ent.name);
    if (!entryIsDirectory(full, ent)) continue;
    if (!disseminationDirNameOk(ent.name)) continue;
    const csv = findNppesCoreCsvInDir(full);
    if (!csv) continue;
    let size = 0;
    try {
      size = fs.statSync(csv).size;
    } catch (_) {}
    if (size > bestSize) {
      bestSize = size;
      bestDir = full;
    }
  }
  if (bestDir) return bestDir;

  if (findNppesCoreCsvInDir(nppesRoot)) return nppesRoot;

  return null;
}

function isCoreNppesCsvFilename(name) {
  const n = String(name || '');
  return /^npidata_pfile_.*\.csv$/i.test(n) && !/fileheader/i.test(n);
}

function isEndpointPfileCsvFilename(name) {
  const n = String(name || '');
  return /^endpoint_pfile_.*\.csv$/i.test(n) && !/fileheader/i.test(n);
}

function findNppesCoreCsvInDir(dir) {
  for (const ent of listEntries(dir)) {
    if (!ent.isFile()) continue;
    if (isCoreNppesCsvFilename(ent.name)) return path.join(dir, ent.name);
  }
  return null;
}

/**
 * Prefer largest npidata_pfile_*.csv under dissemination dir (handles stray small samples).
 * @returns {string|null}
 */
function findPreferredNppesCsvPath(cwd = process.cwd()) {
  const rootDir = resolveNppesDisseminationDir(cwd);
  if (!rootDir) return null;
  const hits = [];
  for (const ent of listEntries(rootDir)) {
    if (!ent.isFile()) continue;
    if (!isCoreNppesCsvFilename(ent.name)) continue;
    const full = path.join(rootDir, ent.name);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch (_) {}
    hits.push({ full, size });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.size - a.size);
  return hits[0].full;
}

/**
 * Newest NPPES dissemination zip directly under .../nppes (not git-friendly at repo root; still supported).
 * @returns {string|null}
 */
function findPreferredNppesZipPath(cwd = process.cwd()) {
  const nppesRoot = path.join(getPayorDataSourcesRoot(cwd), 'nppes');
  const zips = [];
  for (const ent of listEntries(nppesRoot)) {
    if (!ent.isFile()) continue;
    if (!/^NPPES_Data_Dissemination_.*_V2\.zip$/i.test(ent.name)) continue;
    const full = path.join(nppesRoot, ent.name);
    let mtime = 0;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch (_) {}
    zips.push({ full, mtime });
  }
  if (!zips.length) return null;
  zips.sort((a, b) => b.mtime - a.mtime);
  return zips[0].full;
}

/**
 * Largest endpoint_pfile_*.csv next to npidata in the resolved dissemination directory.
 * @returns {string|null}
 */
function findPreferredNppesEndpointCsvPath(cwd = process.cwd()) {
  const rootDir = resolveNppesDisseminationDir(cwd);
  if (!rootDir) return null;
  const hits = [];
  for (const ent of listEntries(rootDir)) {
    if (!ent.isFile()) continue;
    if (!isEndpointPfileCsvFilename(ent.name)) continue;
    const full = path.join(rootDir, ent.name);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch (_) {}
    hits.push({ full, size });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.size - a.size);
  return hits[0].full;
}

module.exports = {
  getPayorDataSourcesRoot,
  resolveNppesDisseminationDir,
  findPreferredNppesCsvPath,
  findPreferredNppesZipPath,
  findPreferredNppesEndpointCsvPath,
  disseminationDirNameOk,
  isCoreNppesCsvFilename,
  isEndpointPfileCsvFilename
};
