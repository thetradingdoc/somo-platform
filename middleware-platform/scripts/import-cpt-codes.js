#!/usr/bin/env node
/**
 * Import CPT codes from the CMS addendum text file into the local SQLite knowledge base.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../database');

const CPT_TEXT_PATH = path.resolve(__dirname, '../../Knowledge/CPT/2025_DHS_Code_List_Addendum_11_26_2024.txt');

function isHeading(line) {
  if (!line) return false;
  const cleaned = line.replace(/[^A-Z0-9 &()\/-]/g, '').trim();
  if (!cleaned) return false;
  if (cleaned.length < 5) return false;
  if (/[0-9]/.test(cleaned) && !/^[0-9]{4,}/.test(cleaned)) return false;
  return cleaned === cleaned.toUpperCase();
}

function normalizeCode(code) {
  if (!code) return null;
  const cleaned = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!cleaned) return null;
  if (!/^[A-Z0-9]{3,7}$/.test(cleaned)) return null;
  return cleaned;
}

function parseCptFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CPT file not found at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let currentCategory = 'Clinical Laboratory Services';
  const codes = [];
  const seen = new Set();

  // Skip header lines
  const skipPatterns = [
    /^LIST OF CPT/i,
    /^This code list is effective/i,
    /^CLINICAL LABORATORY SERVICES/i,
    /^INCLUDE CPT codes/i,
    /^EXCLUDE CPT codes/i,
    /^INCLUDE the following/i,
    /^RADIOLOGY SERVICES/i,
    /^PHYSICAL THERAPY SERVICES/i,
    /^OCCUPATIONAL THERAPY SERVICES/i,
    /^SPEECH-LANGUAGE PATHOLOGY SERVICES/i,
    /^DURABLE MEDICAL EQUIPMENT/i,
    /^PROSTHETICS/i,
    /^ORTHOTICS/i,
    /^HOME HEALTH SERVICES/i,
    /^PERSONAL CARE SERVICES/i,
    /^AMBULANCE SERVICES/i,
    /^SUPPLIES/i,
    /^OTHER SERVICES/i
  ];

  for (let rawLine of lines) {
    if (!rawLine) continue;
    let line = rawLine.replace(/\u00A0/g, ' ').trim();
    if (!line) continue;

    // Skip header lines
    if (skipPatterns.some(pattern => pattern.test(line))) {
      // Update category if it's a section header
      if (/^CLINICAL LABORATORY/i.test(line)) {
        currentCategory = 'Clinical Laboratory Services';
      } else if (/^RADIOLOGY/i.test(line)) {
        currentCategory = 'Radiology Services';
      } else if (/^PHYSICAL THERAPY/i.test(line)) {
        currentCategory = 'Physical Therapy';
      } else if (/^OCCUPATIONAL THERAPY/i.test(line)) {
        currentCategory = 'Occupational Therapy';
      } else if (/^SPEECH/i.test(line)) {
        currentCategory = 'Speech Therapy';
      } else if (/^DURABLE MEDICAL/i.test(line)) {
        currentCategory = 'Durable Medical Equipment';
      } else if (/^PROSTHETICS/i.test(line)) {
        currentCategory = 'Prosthetics';
      } else if (/^ORTHOTICS/i.test(line)) {
        currentCategory = 'Orthotics';
      } else if (/^HOME HEALTH/i.test(line)) {
        currentCategory = 'Home Health';
      } else if (/^AMBULANCE/i.test(line)) {
        currentCategory = 'Ambulance Services';
      } else if (/^SUPPLIES/i.test(line)) {
        currentCategory = 'Supplies';
      } else if (/^OTHER SERVICES/i.test(line)) {
        currentCategory = 'Other Services';
      }
      continue;
    }

    // Skip lines that are just quotes or instructions
    if (line.startsWith('"') && line.endsWith('"')) {
      const inner = line.replace(/^"|"$/g, '').trim();
      if (inner.length > 100 || /^INCLUDE|^EXCLUDE/i.test(inner)) {
        continue;
      }
    }

    // Parse tab-separated or space-separated code and description
    const parts = rawLine.split(/\t+/).map(p => p.trim()).filter(Boolean);
    let code = null;
    let description = null;

    if (parts.length >= 2) {
      code = normalizeCode(parts[0]);
      description = parts.slice(1).join(' ').replace(/"/g, '').trim();
    } else {
      // Try space-separated format: CODE Description
      const match = line.match(/^([0-9A-Za-z]{4,7})\s+(.+)$/);
      if (match) {
        code = normalizeCode(match[1]);
        description = match[2].replace(/"/g, '').trim();
      }
    }

    // Validate code format (must be alphanumeric, 3-7 chars, not all letters)
    if (!code || !description || description.length < 3) {
      continue;
    }

    // Skip if code looks like a header (all caps long text)
    if (code.length > 7 || /^[A-Z]{10,}$/.test(code)) {
      continue;
    }

    // Skip if description is too long (likely a header)
    if (description.length > 200) {
      continue;
    }

    // Skip common non-code patterns
    if (/^(LIST|THIS|INCLUDE|EXCLUDE|CLINICAL|RADIOLOGY|PHYSICAL|OCCUPATIONAL|SPEECH|DURABLE|PROSTHETICS|ORTHOTICS|HOME|AMBULANCE|SUPPLIES|OTHER)/i.test(description)) {
      continue;
    }

    if (seen.has(code)) {
      continue;
    }

    codes.push({
      code,
      description,
      category: currentCategory,
      subcategory: null,
      is_new: /\bNEW\b/i.test(description)
    });

    seen.add(code);
  }

  return codes;
}

function main() {
  try {
    const codes = parseCptFile(CPT_TEXT_PATH);
    db.bulkUpsertCptCodes(codes);
    console.log(`✅ Imported ${codes.length} CPT codes from ${path.basename(CPT_TEXT_PATH)}`);
  } catch (error) {
    console.error('❌ Failed to import CPT codes:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCptFile,
  CPT_TEXT_PATH
};
