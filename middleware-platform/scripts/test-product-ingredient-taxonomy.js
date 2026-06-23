#!/usr/bin/env node
'use strict';

const db = require('../database').db;
const { resolveIngredientFacts, enrichBiochemFacts } = require('../services/catalog/ingredient-ontology-resolver');

function printRows(label, rows) {
  console.log(`\n== ${label} (${rows.length}) ==`);
  for (const r of rows) console.log(JSON.stringify(r));
}

function run() {
  const products = db.prepare(`
    SELECT p.id, p.product_name, p.brand, r.grade_class, r.grade_confidence
    FROM products_catalog p
    LEFT JOIN product_regulatory_profiles r ON r.product_id = p.id
    ORDER BY p.updated_at DESC
    LIMIT 20
  `).all();
  printRows('products_found', products);

  const ingredients = db.prepare(`
    SELECT inci_name, COUNT(*) AS cnt
    FROM product_ingredients
    GROUP BY inci_name
    ORDER BY cnt DESC, inci_name ASC
    LIMIT 40
  `).all();
  printRows('ingredients_found', ingredients);

  const joinedText = ingredients.map((x) => x.inci_name).join(', ');
  const hits = resolveIngredientFacts(joinedText);
  const biochem = enrichBiochemFacts(hits);
  printRows('ingredient_biochem_hits', biochem);

  const lookupEvents = db.prepare(`
    SELECT barcode, source, hit, grade_class, confidence, created_at
    FROM barcode_lookup_events
    ORDER BY created_at DESC
    LIMIT 20
  `).all();
  printRows('barcode_lookup_events', lookupEvents);
}

run();
