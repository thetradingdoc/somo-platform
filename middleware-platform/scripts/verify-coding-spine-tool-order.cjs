#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const knowledgeService = require('../services/knowledge-service');

const MP = path.join(__dirname, '..');
const collectSrc = fs.readFileSync(path.join(MP, 'services/kelly-tool-executor/collect-insurance.js'), 'utf8');
const resolveIdx = collectSrc.indexOf('resolveInsuranceCodes');
const httpIdx = collectSrc.indexOf("executor._post('/voice/insurance/collect'");
const orderOk = resolveIdx >= 0 && httpIdx >= 0 && resolveIdx < httpIdx;

const pairRulesPath = path.join(__dirname, '../../Knowledge/rules/code-pair-validation.json');
const pairRules = JSON.parse(fs.readFileSync(pairRulesPath, 'utf8'));
const pairCount = (pairRules.incompatible_pairs || []).length;
const pairOk = knowledgeService.validateCodePair('Z01.20', '99213').valid === false;

const checks = [
  { name: 'tool_order_rag_before_insurance', pass: orderOk, actual: { resolveIdx, httpIdx } },
  { name: 'pair_rules_loaded', pass: pairCount >= 25, actual: pairCount },
  { name: 'dental_icd_em_pair_blocked', pass: !pairOk, actual: pairOk }
];

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ checks, success: failed.length === 0 }, null, 2));
process.exit(failed.length ? 2 : 0);
