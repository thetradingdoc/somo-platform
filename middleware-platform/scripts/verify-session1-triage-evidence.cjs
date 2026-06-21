#!/usr/bin/env node
'use strict';

/**
 * Session 1 — capture triage spine evidence from a completed voice session.
 * Usage: SESSION_ID=<call_id> node scripts/verify-session1-triage-evidence.cjs
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const sessionId = process.env.SESSION_ID || process.argv[2];
if (!sessionId) {
  console.error('Usage: SESSION_ID=<call_id> node scripts/verify-session1-triage-evidence.cjs');
  process.exit(2);
}

const db = require('../database');
const TriageRAGService = require('../services/triage-rag-service');

const triage = TriageRAGService.getAuthoritativeForSession(sessionId);
const events = db.db?.prepare(`
  SELECT event_type, payload_json, created_at FROM kelly_call_events
  WHERE session_id = ? ORDER BY created_at DESC LIMIT 50
`).all(sessionId) || [];

const pineconeEvidence = events.some((e) =>
  String(e.payload_json || '').includes('pinecone') ||
  String(e.payload_json || '').includes('remote_knowledge')
);

const result = {
  session_id: sessionId,
  primary_icd10: triage?.primary_icd10 || null,
  primary_cpt: triage?.primary_cpt || null,
  rag_confidence: triage?.rag_confidence ?? null,
  pinecone_log_evidence: pineconeEvidence,
  assertion_passed: !!(triage?.primary_icd10) && pineconeEvidence
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.assertion_passed ? 0 : 2);
