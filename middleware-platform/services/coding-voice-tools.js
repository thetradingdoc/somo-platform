'use strict';

/**
 * SSOT for Retell/Kelly coding search tools (G-08).
 */

const db = require('../database');
const knowledgeService = require('./knowledge-service');
const visitCodes = require('./visit-codes-service');

async function searchIcd10Codes(args = {}) {
  const query = String(args.query || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(args.limit, 10) || 10));
  if (!query) return { success: false, error: 'Query is required for ICD-10 search', codes: [] };
  const codes = knowledgeService.searchIcd10Codes(query, limit);
  return {
    success: true,
    codes: codes.map((c) => ({ code: c.code, description: c.description, category: c.category })),
    count: codes.length
  };
}

async function searchCptCodes(args = {}) {
  const query = String(args.query || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(args.limit, 10) || 10));
  if (!query) return { success: false, error: 'Query is required for CPT search', codes: [] };
  const codes = db.searchCptCodes(query, limit);
  return {
    success: true,
    codes: codes.map((c) => ({ code: c.code, description: c.description, category: c.category })),
    count: codes.length
  };
}

async function searchHcpcsCodes(args = {}) {
  const query = String(args.query || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(args.limit, 10) || 10));
  if (!query) return { success: false, error: 'Query is required for HCPCS search', codes: [] };
  const codes = knowledgeService.searchHcpcsCodes(query, limit);
  return {
    success: true,
    codes: codes.map((c) => ({
      code: c.code,
      description: c.description,
      short_desc: c.short_desc,
      type: c.type
    })),
    count: codes.length
  };
}

async function searchCdtCodes(args = {}) {
  const query = String(args.query || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(args.limit, 10) || 10));
  if (!query) return { success: false, error: 'Query is required for CDT search', codes: [] };
  const codes = (db.searchCdtCodes?.(query, limit) || []).map((c) => ({
    code: c.code,
    description: c.description,
    category: c.category,
    subcategory: c.subcategory
  }));
  return { success: true, codes, count: codes.length };
}

async function suggestCodesFromSymptoms(args = {}, ctx = {}) {
  const text = args.clinical_text || args.symptoms || args.query || '';
  const codes = await visitCodes.getVisitCodes(text, {
    clinicId: ctx.clinicId || args.clinic_id,
    callId: ctx.sessionId || args.call_id,
    maxIcd10: args.max_icd10 || 5,
    maxCpt: args.max_cpt || 3,
    useSemantic: args.use_semantic !== false
  });
  return { success: true, ...codes };
}

function validateCodePair(args = {}) {
  const icd10 = String(args.icd10 || args.icd10_code || '').trim();
  const cpt = String(args.cpt || args.cpt_code || args.service_code || '').trim();
  if (!icd10 || !cpt) {
    return { success: false, error: 'icd10 and cpt are required', valid: false };
  }
  const check = knowledgeService.validateCodePair(icd10, cpt);
  return { success: true, valid: check.valid, reason: check.reason || null };
}

module.exports = {
  searchIcd10Codes,
  searchCptCodes,
  searchHcpcsCodes,
  searchCdtCodes,
  suggestCodesFromSymptoms,
  validateCodePair
};
