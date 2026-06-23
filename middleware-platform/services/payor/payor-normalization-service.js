'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');

const DEFAULT_STOPWORDS = new Set([
  'insurance', 'ins', 'company', 'co', 'corp', 'corporation', 'inc', 'llc', 'ltd', 'pllc',
  'of', 'the', 'and', 'plan', 'health', 'care', 'services'
]);

const STATE_MAP = new Map([
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'], ['california', 'CA'],
  ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'], ['district', 'DC'], ['florida', 'FL'],
  ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'], ['illinois', 'IL'], ['indiana', 'IN'],
  ['iowa', 'IA'], ['kansas', 'KS'], ['kentucky', 'KY'], ['louisiana', 'LA'], ['maine', 'ME'],
  ['maryland', 'MD'], ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'], ['mississippi', 'MS'],
  ['missouri', 'MO'], ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'], ['hampshire', 'NH'],
  ['jersey', 'NJ'], ['mexico', 'NM'], ['york', 'NY'], ['carolina', 'NC'], ['dakota', 'ND'],
  ['ohio', 'OH'], ['oklahoma', 'OK'], ['oregon', 'OR'], ['pennsylvania', 'PA'], ['island', 'RI'],
  ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'], ['virginia', 'VA'],
  ['washington', 'WA'], ['wisconsin', 'WI'], ['wyoming', 'WY']
]);

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function soundex(input) {
  const word = String(input || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!word) return '';
  const first = word[0];
  const map = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let prev = map[first] || 0;
  const out = [first];
  for (let i = 1; i < word.length && out.length < 4; i++) {
    const c = word[i];
    const code = map[c] || 0;
    if (code && code !== prev) out.push(String(code));
    prev = code;
  }
  while (out.length < 4) out.push('0');
  return out.join('');
}

function extractState(tokens) {
  if (!tokens.length) return { stripped_state: null, tokens };
  const last = tokens[tokens.length - 1];
  if (/^[a-z]{2}$/.test(last)) return { stripped_state: last.toUpperCase(), tokens: tokens.slice(0, -1) };
  if (STATE_MAP.has(last)) return { stripped_state: STATE_MAP.get(last), tokens: tokens.slice(0, -1) };
  if (tokens.length >= 2) {
    const duo = tokens.slice(-2).join(' ');
    const stateByPhrase = new Map([['new york', 'NY'], ['new jersey', 'NJ'], ['new mexico', 'NM'], ['north carolina', 'NC'], ['south carolina', 'SC'], ['north dakota', 'ND'], ['south dakota', 'SD'], ['west virginia', 'WV'], ['rhode island', 'RI']]);
    if (stateByPhrase.has(duo)) return { stripped_state: stateByPhrase.get(duo), tokens: tokens.slice(0, -2) };
  }
  return { stripped_state: null, tokens };
}

function buildPrefixKey(tokens) {
  if (!tokens.length) return '';
  return tokens.slice(0, 3).map((t) => t.slice(0, 4)).join('_');
}

function loadDictionaries() {
  const abbrRows = db.getActivePayorAbbreviations();
  const stopwordRows = db.getActivePayorStopwords();
  const abbreviationMap = new Map(abbrRows.map((r) => [String(r.abbr).toLowerCase(), String(r.expanded_form).toLowerCase()]));
  const stopwords = new Set(stopwordRows.map((r) => String(r.word).toLowerCase()));
  for (const w of DEFAULT_STOPWORDS) stopwords.add(w);
  return { abbreviationMap, stopwords };
}

function normalizePayorName(rawName, dictionaries = null) {
  const dict = dictionaries || loadDictionaries();
  const base = normalizeText(rawName);
  if (!base) {
    return {
      normalized_name: '',
      normalized_tokens: [],
      canonical_tokens: [],
      stripped_state: null,
      soundex_key: '',
      prefix_key: ''
    };
  }

  const tokens = base.split(' ').filter(Boolean);
  const expandedTokens = [];
  for (const token of tokens) {
    const exp = dict.abbreviationMap.get(token);
    if (exp) expandedTokens.push(...normalizeText(exp).split(' ').filter(Boolean));
    else expandedTokens.push(token);
  }

  const withoutStopwords = expandedTokens.filter((t) => !dict.stopwords.has(t));
  const stateExtracted = extractState(withoutStopwords);
  const normalizedTokens = stateExtracted.tokens;
  const canonicalTokens = [...normalizedTokens].sort();
  const normalized_name = normalizedTokens.join(' ');

  return {
    normalized_name,
    normalized_tokens: normalizedTokens,
    canonical_tokens: canonicalTokens,
    stripped_state: stateExtracted.stripped_state,
    soundex_key: soundex(normalizedTokens[0] || ''),
    prefix_key: buildPrefixKey(normalizedTokens)
  };
}

function normalizeRawRecords({ source = null, limit = 5000, offset = 0, normalizationVersion = 'v1' } = {}) {
  const dictionaries = loadDictionaries();
  const rows = db.getPayorSourceRecordsForNormalization({ source, limit, offset });
  const out = rows
    .filter((r) => r && r.id && r.raw_name)
    .map((r) => {
      const n = normalizePayorName(r.raw_name, dictionaries);
      return {
        id: `payor_norm_${uuidv4()}`,
        source_record_id: r.id,
        source: r.source || 'unknown',
        normalized_name: n.normalized_name || '',
        normalized_tokens_json: n.normalized_tokens,
        canonical_tokens_json: n.canonical_tokens,
        stripped_state: n.stripped_state,
        soundex_key: n.soundex_key,
        prefix_key: n.prefix_key,
        normalization_version: normalizationVersion
      };
    });
  const upserted = db.upsertPayorNormalizedRecords(out);
  return { scanned: rows.length, normalized: out.length, upserted, normalizationVersion };
}

module.exports = {
  loadDictionaries,
  normalizePayorName,
  normalizeRawRecords,
  soundex
};

