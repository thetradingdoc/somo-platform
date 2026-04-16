const fs = require('fs');
const path = require('path');
const { buildCategoryRoutePayload } = require('../services/scan-route-response');

describe('category route API contract', () => {
  test('shared payload builder exposes canonical field names', () => {
    const out = buildCategoryRoutePayload({
      active: {
        route: 'cosmetic',
        source: 'taxonomy_map',
        confidence_band: 'high',
        rule_id: 'tag:en:cosmetics',
        fallback_text: null,
        map_version: '1.0.0'
      },
      rollout_mode: 'primary_only',
      canary_applied: false
    });
    expect(out).toHaveProperty('category_route', 'cosmetic');
    expect(out).toHaveProperty('category_route_source', 'taxonomy_map');
    expect(out).toHaveProperty('category_route_confidence', 'high');
    expect(out).toHaveProperty('category_route_rule_id', 'tag:en:cosmetics');
    expect(out).not.toHaveProperty('category_route_top');
  });

  test('beautyfacts and foodfacts handlers both use shared payload builder', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf8');
    const occurrences = (src.match(/\.\.\.buildCategoryRoutePayload\(categoryEval\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test('server exposes scan_summary feature gate variable', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf8');
    expect(src.includes('SCAN_SUMMARY_V1')).toBe(true);
  });
});
