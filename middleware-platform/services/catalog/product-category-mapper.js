const fs = require('fs');
const path = require('path');

const TAX_PATH = path.resolve(__dirname, '../taxonomy/product-category-taxonomy.v1.json');
let _tax = null;
function load() {
  if (_tax) return _tax;
  _tax = JSON.parse(fs.readFileSync(TAX_PATH, 'utf8'));
  return _tax;
}

function mapProductCategory(inputText) {
  const t = String(inputText || '').toLowerCase();
  for (const r of (load().mapping_rules || [])) {
    if (new RegExp(r.pattern, 'i').test(t)) return r.category;
  }
  return 'UNKNOWN';
}

module.exports = { mapProductCategory };
