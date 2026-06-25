'use strict';

const fs = require('fs');
const path = require('path');
const { METRO_ENTITY_ID } = require('../../scripts/lib/navigation-demo-config.cjs');

let benefitsCard = null;

function loadBenefitsCard() {
  if (benefitsCard) return benefitsCard;
  const p = path.join(__dirname, '../../data/navigation/metro-health-plus-benefits.json');
  benefitsCard = JSON.parse(fs.readFileSync(p, 'utf8'));
  return benefitsCard;
}

function checkPlanBenefits({ payor_entity_id, zip, specialty_key } = {}) {
  const card = loadBenefitsCard();
  if (payor_entity_id && payor_entity_id !== METRO_ENTITY_ID && payor_entity_id !== card.payor_entity_id) {
    return {
      success: false,
      error: 'benefits_card_missing',
      message: 'Benefit details are not available for that plan in the demo yet.'
    };
  }

  const benefits = card.benefits || {};
  const keys = specialty_key ? [specialty_key] : Object.keys(benefits);
  const summaries = keys.map((key) => ({
    specialty_key: key,
    covered: !!benefits[key]?.covered,
    summary: benefits[key]?.summary || null,
    copay_hint: benefits[key]?.copay_hint || null
  }));

  return {
    success: true,
    plan_display_name: card.plan_display_name,
    payor_entity_id: card.payor_entity_id,
    region: card.region,
    zip: zip || null,
    benefits: summaries,
    disclaimer: card.disclaimer
  };
}

function getCopayHintForSpecialty(specialty) {
  const card = loadBenefitsCard();
  const keyMap = {
    Dental: 'dental',
    Orthodontics: 'orthodontics',
    Optometry: 'vision',
    Psychiatry: 'mental_health',
    PrimaryCare: 'primary_care'
  };
  const key = keyMap[specialty] || specialtyKeyForBenefits(specialty);
  const row = card.benefits?.[key];
  return row?.copay_hint || null;
}

function specialtyKeyForBenefits(specialty) {
  const map = {
    Dental: 'dental',
    Orthodontics: 'orthodontics',
    Optometry: 'vision',
    Psychiatry: 'mental_health',
    PrimaryCare: 'primary_care'
  };
  return map[specialty] || null;
}

module.exports = { checkPlanBenefits, loadBenefitsCard, getCopayHintForSpecialty, specialtyKeyForBenefits };
