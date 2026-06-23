#!/usr/bin/env node
'use strict';

const db = require('../../database');

const FRAGRANCE_ALLERGENS = [
  'amyl cinnamal', 'benzyl alcohol', 'cinnamyl alcohol', 'citral', 'eugenol',
  'hydroxycitronellal', 'isoeugenol', 'amylcinnamyl alcohol', 'benzyl salicylate',
  'cinnamal', 'coumarin', 'geraniol', 'hydroxyisohexyl 3-cyclohexene carboxaldehyde',
  'anise alcohol', 'benzyl cinnamate', 'farnesol', 'butylphenyl methylpropional',
  'linalool', 'benzyl benzoate', 'citronellol', 'hexyl cinnamal', 'limonene',
  'methyl 2-octynoate', 'alpha-isomethyl ionone', 'evernia prunastri extract',
  'evernia furfuracea extract'
];

const ROLE_SEED = [
  { inci: 'water', functions: ['solvent'] },
  { inci: 'glycerin', functions: ['humectant'] },
  { inci: 'niacinamide', functions: ['skin conditioning'] },
  { inci: 'salicylic acid', functions: ['keratolytic', 'preservative'] },
  { inci: 'ascorbic acid', functions: ['antioxidant'] },
  { inci: 'tocopherol', functions: ['antioxidant'] },
  { inci: 'phenoxyethanol', functions: ['preservative'] },
  { inci: 'sodium laureth sulfate', functions: ['surfactant', 'cleansing'] },
  { inci: 'cocamidopropyl betaine', functions: ['surfactant', 'foam boosting'] },
  { inci: 'fragrance', functions: ['perfuming'] },
  { inci: 'citric acid', functions: ['buffering'] },
  { inci: 'xanthan gum', functions: ['viscosity controlling'] },
  { inci: 'caprylyl glycol', functions: ['humectant'] },
  { inci: 'sodium gluconate', functions: ['chelating'] },
  { inci: 'sodium stearoyl glutamate', functions: ['emulsifying'] },
  { inci: 'glyceryl monostearate', functions: ['emulsifying'] },
  { inci: 'cetearyl olivate', functions: ['emollient', 'emulsifying'] },
  { inci: 'erythritol', functions: ['humectant'] },
  { inci: 'phospholipids', functions: ['skin conditioning'] },
  { inci: 'glycine soja oil', functions: ['emollient'] },
  { inci: 'sodium lauroyl methyl isethionate', functions: ['surfactant', 'cleansing'] },
  { inci: 'sodium methyl oleoyl taurate', functions: ['surfactant', 'cleansing'] },
  { inci: 'melaleuca alternifolia leaf oil', functions: ['perfuming'] },
  { inci: 'rosmarinus officinalis leaf oil', functions: ['perfuming'] }
];

const ALIAS_SEED = [
  ['aqua', 'water'],
  ['eau', 'water'],
  ['vitamin b3', 'niacinamide'],
  ['vitamin b 3', 'niacinamide'],
  ['vitamin c', 'ascorbic acid'],
  ['l-ascorbic acid', 'ascorbic acid'],
  ['bha', 'salicylic acid'],
  ['parfum', 'fragrance'],
  ['vegetable glycerin', 'glycerin'],
  ['organic vitamin e', 'tocopherol'],
  ['ifra certified fragrance', 'fragrance'],
  ['xanthan gum plant-based', 'xanthan gum'],
  ['sodium gluconate corn & beets', 'sodium gluconate'],
  ['caprylyl glycol coconut oil', 'caprylyl glycol'],
  ['citric acid lemon', 'citric acid'],
  ['sodium stearoyl glutamate coconut', 'sodium stearoyl glutamate'],
  ['cetearyl olivate olive oil', 'cetearyl olivate'],
  ['sodium lauroyl methyl isethionate coconut', 'sodium lauroyl methyl isethionate'],
  ['sodium methyl oleoyl taurate olive', 'sodium methyl oleoyl taurate'],
  ['tea tree oil', 'melaleuca alternifolia leaf oil'],
  ['rosemary oil', 'rosmarinus officinalis leaf oil']
];

function run() {
  let seededCosing = 0;
  let seededAliases = 0;

  for (const row of ROLE_SEED) {
    const out = db.upsertCosingIngredient({
      inci_name: row.inci,
      functions: row.functions,
      restrictions: [],
      metadata: { source: 'phase2_seed' }
    });
    if (out?.success) seededCosing += 1;
  }

  for (const inci of FRAGRANCE_ALLERGENS) {
    db.db.prepare(`
      INSERT INTO cosing_ingredients (
        inci_name, functions_json, restrictions_json, metadata_json,
        is_allergen, allergen_type, is_eu_restricted, updated_at
      ) VALUES (?, '[]', '[]', ?, 1, 'fragrance', 0, datetime('now'))
      ON CONFLICT(inci_name) DO UPDATE SET
        is_allergen = 1,
        allergen_type = 'fragrance',
        updated_at = datetime('now')
    `).run(inci, JSON.stringify({ source: 'phase2_seed_fragrance_allergens' }));
    seededCosing += 1;
  }

  for (const [alias, canonical] of ALIAS_SEED) {
    const out = db.upsertIngredientAlias(alias, canonical, 'phase2 curated baseline', 'phase2_seed');
    if (out?.success) seededAliases += 1;
  }

  console.log(`seed-cosing-ingredients: seeded/updated cosing=${seededCosing}, aliases=${seededAliases}`);
}

run();
