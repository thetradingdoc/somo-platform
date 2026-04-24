const fs = require('fs');
const path = require('path');

describe('scan -> enrichment -> kelly contract', () => {
  test('public scan endpoints return enrichment payload + grounding metadata', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf8');
    const enrichedOccurrences = (src.match(/ingredients_enriched/g) || []).length;
    const summaryOccurrences = (src.match(/ingredient_summary/g) || []).length;
    const groundingOccurrences = (src.match(/grounding_metadata/g) || []).length;
    expect(enrichedOccurrences).toBeGreaterThanOrEqual(2);
    expect(summaryOccurrences).toBeGreaterThanOrEqual(2);
    expect(groundingOccurrences).toBeGreaterThanOrEqual(2);
  });

  test('landing assistant forwards scan grounding into Kelly turn', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf8');
    expect(src.includes('scanGrounding: latestBarcodeContextEvent?.product_data || null')).toBe(true);
  });

  test('kelly prompt enforces structured ingredient grounding rule', () => {
    const kellyPath = path.join(__dirname, '..', 'services', 'kelly-agent-service.js');
    const src = fs.readFileSync(kellyPath, 'utf8');
    expect(src.includes('Do NOT re-parse raw `ingredients_text`.')).toBe(true);
    expect(src.includes('Structured ingredient context (authoritative)')).toBe(true);
  });
});
