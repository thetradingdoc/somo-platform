#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

const abbreviations = [
  ['uhc', 'unitedhealthcare'], ['unh', 'unitedhealthcare'], ['bcbs', 'blue cross blue shield'],
  ['hcsc', 'health care service corporation'], ['aetna', 'aetna'],
  ['hum', 'humana'], ['cigna', 'cigna'], ['kaiser', 'kaiser permanente'],
  ['hmo', 'health maintenance organization'], ['ppo', 'preferred provider organization'],
  ['epo', 'exclusive provider organization'], ['pos', 'point of service'],
  ['med', 'medical'], ['medicare', 'medicare'], ['medicaid', 'medicaid'],
  ['anthem', 'anthem'], ['wellcare', 'wellcare'], ['molina', 'molina healthcare'],
  ['centene', 'centene'], ['ambetter', 'ambetter'], ['oscar', 'oscar health'],
  ['horizon', 'horizon blue cross blue shield'], ['highmark', 'highmark'],
  ['carefirst', 'carefirst bluecross blueshield'], ['capital', 'capital blue cross'],
  ['independence', 'independence blue cross'], ['tufts', 'tufts health plan'],
  ['harvard', 'harvard pilgrim'], ['pilgrim', 'harvard pilgrim'],
  ['geha', 'government employees health association'], ['tricare', 'tricare'],
  ['champva', 'champva'], ['fep', 'federal employee program'],
  ['pdp', 'prescription drug plan'], ['mapd', 'medicare advantage prescription drug'],
  ['snp', 'special needs plan'], ['ipa', 'independent practice association'],
  ['hp', 'health plan'], ['grp', 'group'], ['comm', 'commercial'],
  ['supp', 'supplemental'], ['ind', 'individual'], ['natl', 'national'],
  ['assoc', 'association'], ['svc', 'services'], ['svcs', 'services'],
  ['admin', 'administrators'], ['mgmt', 'management'], ['rx', 'pharmacy'],
  ['beh', 'behavioral'], ['bh', 'behavioral health'], ['caid', 'medicaid'],
  ['mcr', 'medicare'], ['adv', 'advantage'], ['intl', 'international'],
  ['bc', 'blue cross'], ['bs', 'blue shield']
].map(([abbr, expanded_form]) => ({ abbr, expanded_form, active: 1, source: 'step2_seed_v1' }));

const stopwords = [
  'insurance', 'ins', 'company', 'co', 'corp', 'corporation', 'inc', 'llc', 'ltd', 'pllc',
  'of', 'the', 'and', 'a', 'an', 'for', 'plan', 'plans', 'health', 'care', 'services', 'service'
];

const upsertedAbbr = db.bulkUpsertPayorAbbreviations(abbreviations);
const upsertedStopwords = db.bulkUpsertPayorStopwords(stopwords, 'step2_seed_v1');

console.log(JSON.stringify({
  event: 'payor_normalization_dictionary_seeded',
  abbreviation_rows: upsertedAbbr,
  stopword_rows: upsertedStopwords
}, null, 2));

