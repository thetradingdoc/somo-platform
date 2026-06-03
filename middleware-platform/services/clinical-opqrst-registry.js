'use strict';

const fs = require('fs');
const path = require('path');
const { isOpqrstEsPackActive } = require('./kelly-rails/config');

const cache = {};

function loadPack(locale) {
  const loc = String(locale || 'en').slice(0, 2);
  if (cache[loc]) return cache[loc];
  const file = path.join(__dirname, '..', 'config', 'clinical-opqrst', `${loc}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    cache[loc] = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cache[loc];
  } catch (_) {
    return null;
  }
}

function getNextQuestion(locale, stepId, specialty) {
  const loc = String(locale || 'en').slice(0, 2);
  if (loc === 'es' && !isOpqrstEsPackActive()) return null;
  const pack = loadPack(loc);
  if (!pack?.questions) return null;
  const q = pack.questions[stepId];
  if (!q?.text) return null;
  return { question_id: stepId, text: q.text, store_field: q.store_field };
}

function getOpqrstHintForClinicalLane(state = {}) {
  const step = String(state.step || '');
  const map = {
    clinical_intake: 'opqrst_onset',
    medical_history: 'opqrst_provocation',
    medications: 'opqrst_quality',
    symptoms: 'opqrst_radiation',
    triage_assessment: 'opqrst_severity'
  };
  const stepId = map[step];
  if (!stepId) return null;
  return { stepId, specialty: 'dermatology' };
}

module.exports = {
  loadPack,
  getNextQuestion,
  getOpqrstHintForClinicalLane
};
