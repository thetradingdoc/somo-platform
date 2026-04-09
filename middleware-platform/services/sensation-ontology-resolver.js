const fs = require('fs');
const path = require('path');

const ONTOLOGY_PATH = path.resolve(__dirname, '../taxonomy/sensation-ontology.v1.jsonld');
let _ontology = null;

function load() {
  if (_ontology) return _ontology;
  _ontology = JSON.parse(fs.readFileSync(ONTOLOGY_PATH, 'utf8'));
  return _ontology;
}

function resolveSensationSignals(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  for (const s of (load().signals || [])) {
    for (const a of (s.aliases || [])) {
      if (t.includes(String(a).toLowerCase())) {
        out.push({ signal: s.signal, category: s.category, alias: a });
        break;
      }
    }
  }
  return out;
}

module.exports = { resolveSensationSignals };
