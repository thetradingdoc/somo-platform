'use strict';

const SKIN_FRAGMENTS = [
  'rash', 'rashes', 'lesion', 'bump', 'bumps', 'spot', 'spots', 'mole',
  'itch', 'itchy', 'itching', 'hives', 'eczema', 'dermatitis', 'skin change',
  'red patch', 'blister', 'blisters', 'acne', 'pimple', 'pimples'
];

function isSkinConcern(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(no rash|don'?t have a rash|without rash)\b/.test(t)) return false;
  return SKIN_FRAGMENTS.some((f) => t.includes(f));
}

function latestVisionCaption(metadata = {}) {
  const artifacts = metadata.vision_artifacts || [];
  if (!artifacts.length) return '';
  const last = artifacts[artifacts.length - 1];
  return last?.caption || '';
}

module.exports = {
  isSkinConcern,
  SKIN_FRAGMENTS,
  latestVisionCaption
};
