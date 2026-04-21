const db = require('../database');
const PayorRegistryResolverService = require('../services/payor-registry-resolver-service');

function resetResolverFixtures() {
  db.db.prepare(`DELETE FROM payor_entity_aliases WHERE entity_id = ?`).run('ent_uhc');
  db.db.prepare(`DELETE FROM payor_entity_links WHERE entity_id = ?`).run('ent_uhc');
  db.db.prepare(`DELETE FROM provider_payer_networks WHERE payor_entity_id = ?`).run('ent_uhc');
  db.db.prepare(`DELETE FROM payor_canonical_entities WHERE id = ?`).run('ent_uhc');
}

describe('payor registry resolver service', () => {
  beforeEach(() => {
    resetResolverFixtures();
  });

  test('resolves distinct payer text aliases to the same canonical entity', () => {
    const now = new Date().toISOString();
    db.db.prepare(`
      INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
      VALUES ('ent_uhc', 'UnitedHealthcare', 'PAYER-UHC-1', 'active', ?, ?)
    `).run(now, now);
    const aliases = [
      ['alias1', 'UHC'],
      ['alias2', 'United Health Care'],
      ['alias3', 'UnitedHealthcare']
    ];
    const ins = db.db.prepare(`
      INSERT INTO payor_entity_aliases (id, entity_id, alias, alias_normalized, source, confidence, created_at)
      VALUES (?, 'ent_uhc', ?, ?, 'fixture', 1.0, ?)
    `);
    for (const [id, text] of aliases) {
      const norm = String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      ins.run(id, text, norm, now);
    }

    const r1 = PayorRegistryResolverService.resolvePayor({ payerText: 'UHC' });
    const r2 = PayorRegistryResolverService.resolvePayor({ payerText: 'United Health Care' });
    expect(r1.resolved).toBe(true);
    expect(r2.resolved).toBe(true);
    expect(r1.canonical_entity.id).toBe('ent_uhc');
    expect(r2.canonical_entity.id).toBe('ent_uhc');
  });

  test('returns unresolved safe shape for unknown payer text (no throw)', () => {
    const out = PayorRegistryResolverService.resolvePayor({ payerText: '%%%not-a-real-payer-xyz%%%' });
    expect(out.resolved).toBe(false);
    expect(out.canonical_entity).toBeNull();
    expect(out.resolution_source).toBe('none');
  });
});
