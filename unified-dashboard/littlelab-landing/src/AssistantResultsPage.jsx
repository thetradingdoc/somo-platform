import React, { useState, useMemo, useCallback } from 'react';
import { normalizeHttpApiBase } from './landingAssistantApi';
import { pickFirstProductImageUrl } from './scanInsights';
import './AssistantResultsPage.css';

// ─── Ingredient intelligence ──────────────────────────────────────────────────

const BENEFICIAL = {
  niacinamide: { label: 'Niacinamide', benefit: 'Brightening & pore-minimising' },
  'hyaluronic acid': { label: 'Hyaluronic Acid', benefit: 'Deep hydration' },
  'sodium hyaluronate': { label: 'Hyaluronic Acid', benefit: 'Deep hydration' },
  'salicylic acid': { label: 'Salicylic Acid', benefit: 'Acne-fighting (BHA)' },
  glycerin: { label: 'Glycerin', benefit: 'Moisture retention' },
  'ascorbic acid': { label: 'Vitamin C', benefit: 'Antioxidant & brightening' },
  'vitamin c': { label: 'Vitamin C', benefit: 'Antioxidant & brightening' },
  retinol: { label: 'Retinol', benefit: 'Anti-ageing & cell turnover' },
  tretinoin: { label: 'Tretinoin (Rx)', benefit: 'Prescription retinoid' },
  'ceramide np': { label: 'Ceramide', benefit: 'Barrier repair' },
  'ceramide ap': { label: 'Ceramide', benefit: 'Barrier repair' },
  ceramide: { label: 'Ceramide', benefit: 'Barrier repair' },
  'snail secretion filtrate': { label: 'Snail Mucin', benefit: 'Healing & hydration' },
  'centella asiatica': { label: 'Centella Asiatica', benefit: 'Calming & anti-inflammatory' },
  panthenol: { label: 'Panthenol (B5)', benefit: 'Soothing & healing' },
  allantoin: { label: 'Allantoin', benefit: 'Skin-soothing' },
  'lactic acid': { label: 'Lactic Acid', benefit: 'Gentle exfoliant (AHA)' },
  'glycolic acid': { label: 'Glycolic Acid', benefit: 'Exfoliating (AHA)' },
  'mandelic acid': { label: 'Mandelic Acid', benefit: 'Gentle AHA exfoliant' },
  'azelaic acid': { label: 'Azelaic Acid', benefit: 'Anti-acne & redness' },
  tocopherol: { label: 'Vitamin E', benefit: 'Antioxidant barrier support' },
  'zinc oxide': { label: 'Zinc Oxide', benefit: 'Oil control & mineral SPF' },
  'copper tripeptide-1': { label: 'Copper Peptide', benefit: 'Skin regeneration' },
  'benzoyl peroxide': { label: 'Benzoyl Peroxide', benefit: 'Acne-fighting antimicrobial' },
  'kojic acid': { label: 'Kojic Acid', benefit: 'Dark spot brightening' }
};

const WATCH_OUT = {
  fragrance: 'Can irritate sensitive skin',
  parfum: 'Can irritate sensitive skin',
  'alcohol denat.': 'Drying — may disrupt barrier',
  'alcohol denat': 'Drying — may disrupt barrier',
  'sd alcohol': 'Drying — may disrupt barrier',
  'sodium lauryl sulfate': 'Harsh surfactant — strips barrier',
  'sodium laureth sulfate': 'Can irritate with frequent use',
  methylparaben: 'Preservative — patch test if sensitive',
  propylparaben: 'Preservative — patch test if sensitive',
  'isopropyl myristate': 'Potentially comedogenic',
  'isopropyl palmitate': 'Potentially comedogenic',
  'mineral oil': 'Occlusive — can block pores',
  limonene: 'Common fragrance allergen',
  linalool: 'Common fragrance allergen',
  'benzyl alcohol': 'Potential sensitiser at high %',
  formaldehyde: 'Strong sensitiser — avoid',
  'dmdm hydantoin': 'Releases formaldehyde'
};

function classifyIngredients(text) {
  if (!text) return { good: [], watch: [] };

  const tokens = text
    .split(/[,;]+/)
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*/g, '')
        .trim()
    )
    .filter(Boolean);

  const good = [];
  const watch = [];
  const seenGoodLabels = new Set();

  for (const token of tokens) {
    let matched = false;

    for (const [key, info] of Object.entries(BENEFICIAL)) {
      if (token.includes(key) || key.includes(token)) {
        if (!seenGoodLabels.has(info.label)) {
          seenGoodLabels.add(info.label);
          good.push(info);
        }
        matched = true;
        break;
      }
    }
    if (matched) continue;

    for (const [key, reason] of Object.entries(WATCH_OUT)) {
      if (token.includes(key) || key.includes(token)) {
        watch.push({ label: _titleCase(key), reason });
        break;
      }
    }
  }

  return { good, watch };
}

function sanitizeIngredientText(raw) {
  return String(raw || '')
    .replace(
      /<span[^>]*class=(?:"|')allergen(?:"|')[^>]*>([^<]*)<\/span>/gi,
      (_, name) => String(name || '').toUpperCase()
    )
    .replace(/<[^>]+>/g, '')
    .trim();
}

function catalogSourceLabel(source) {
  const s = String(source || '').trim();
  if (s === 'open_food_facts') return 'Open Food Facts';
  if (s === 'open_beauty_facts') return 'Open Beauty Facts';
  return null;
}

/** Prominent category chip (cosmetic vs food, etc.) — uses `category_route`, else catalog source. */
function categoryRoutePresentation(routeRaw, catalogSource) {
  let r = String(routeRaw || '').toLowerCase().trim();
  if (!r || r === 'unknown') {
    const s = String(catalogSource || '').trim();
    if (s === 'open_food_facts') r = 'food';
    else if (s === 'open_beauty_facts') r = 'cosmetic';
  }
  if (r === 'food' || r === 'beverage') return { label: 'Food & beverage', mod: 'food' };
  if (r === 'cosmetic' || r === 'skincare' || r === 'personal_care') return { label: 'Cosmetic', mod: 'cosmetic' };
  if (r === 'supplement') return { label: 'Supplement', mod: 'supplement' };
  if (!r || r === 'unknown') return { label: 'Category unknown', mod: 'unknown' };
  return { label: r.replace(/_/g, ' '), mod: 'other' };
}

/** Snapshot may store route confidence as 0–1 (server) or band strings (API). */
function routeConfidenceLabelFromSnapshot(routeScore) {
  if (routeScore == null || routeScore === '') return null;
  if (typeof routeScore === 'string') {
    const v = routeScore.toLowerCase().trim();
    if (v === 'high') return 'High confidence';
    if (v === 'medium') return 'Medium confidence';
    if (v === 'low') return 'Low confidence';
    return null;
  }
  const n = Number(routeScore);
  if (!Number.isFinite(n)) return null;
  if (n >= 0.75) return 'High confidence';
  if (n >= 0.5) return 'Medium confidence';
  return 'Low confidence';
}

function heroMetaConfidenceMod(snapshot, globalConfidencePct) {
  const raw = snapshot?.scanned_product?.category_route_confidence ?? snapshot?.route_confidence;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 0.75 ? 'high' : raw >= 0.5 ? 'mid' : 'low';
  }
  if (typeof raw === 'string') {
    const v = raw.toLowerCase();
    if (v === 'high') return 'high';
    if (v === 'medium') return 'mid';
    if (v === 'low') return 'low';
  }
  return globalConfidencePct >= 75 ? 'high' : globalConfidencePct >= 50 ? 'mid' : 'low';
}

/** When category route is resolved, show taxonomy-based confidence instead of global % + catalog name. */
function taxonomyHeroMetaLine(snapshot, categoryRoute, globalConfidencePct) {
  const route = String(categoryRoute || '').toLowerCase().trim();
  if (!route || route === 'unknown') return null;
  const raw = snapshot?.scanned_product?.category_route_confidence ?? snapshot?.route_confidence;
  const fromRoute = routeConfidenceLabelFromSnapshot(raw);
  const confLabel =
    fromRoute ||
    (globalConfidencePct >= 75
      ? 'High confidence'
      : globalConfidencePct >= 50
        ? 'Medium confidence'
        : 'Low confidence');
  return `${confLabel} · taxonomy map`;
}

const INGREDIENT_LIST_MAX_CHARS = 3200;

/** Human-readable copy for tile `reason_unavailable` codes (avoid raw enum strings in UI). */
const TILE_REASON_COPY = {
  missing_ingredients: 'No ingredient line in catalog',
  not_applicable_cosmetic_actives: 'Not applicable — food/beverage (no cosmetic “actives” here)',
  not_applicable_cosmetic_function: 'Not applicable — food/beverage (skincare function)',
  not_applicable_skin_type_for_food: 'Not applicable — food/beverage (skin type)',
  category_unknown: 'Category unclear',
  no_profile_context: 'Needs profile context',
  no_scoring_pipeline: 'Safety score not available yet',
  sparse_data: 'Not enough ingredient detail for a full read',
  reasoning_disabled: 'Deeper analysis not enabled for this scan',
  insufficient_data: 'Not enough data yet',
  unsupported_for_route: 'Not applicable for this category route',
  reasoning_insufficient_evidence: 'Reasoning skipped due to insufficient route-grounded evidence'
};

const TILE_SOURCE_COPY = {
  deterministic: 'Auto-detected',
  graph: 'From your profile',
  reasoning: 'AI-assisted',
  none: null
};

const TILE_CONF_COPY = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence'
};

function formatTileMeta(tile) {
  if (!tile) return null;
  const parts = [];
  const srcKey = String(tile.source || '').toLowerCase();
  const srcLabel = TILE_SOURCE_COPY[srcKey] ?? (tile.source ? TILE_SOURCE_COPY[tile.source] : null);
  if (srcKey && srcKey !== 'none' && srcLabel) parts.push(srcLabel);
  const confKey = String(tile.confidence || '').toLowerCase();
  if (confKey && TILE_CONF_COPY[confKey]) {
    const c = TILE_CONF_COPY[confKey];
    parts.push(c.charAt(0).toLowerCase() + c.slice(1));
  }
  return parts.length ? parts.join(' · ') : null;
}

function formatTileBody(tile) {
  if (!tile || tile.status === 'available') return null;
  const code = tile.reason_unavailable;
  if (!code) return 'Unavailable';
  return TILE_REASON_COPY[code] || String(code).replace(/_/g, ' ');
}

function shouldShowAlternativesCta(alt) {
  return !!(alt && alt.status === 'available' && Array.isArray(alt.candidates) && alt.candidates.length > 0);
}

function sideEffectsDisplayText(verdict) {
  const se = verdict?.side_effects;
  if (typeof se === 'string' && se.trim()) return se.trim();
  const s = se?.summary || se?.text;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return 'Not assessed in this scan.';
}

function formatDisclaimerLine(raw) {
  const d = String(raw || '').trim();
  if (d === 'informational_only') {
    return 'For informational guidance only. Not medical advice.';
  }
  return d || 'For informational guidance only. Not medical advice.';
}

function formatVerdictAnswer(answer, fallback = 'Unknown') {
  const v = String(answer || '').trim().toLowerCase();
  if (!v) return fallback;
  if (v === 'yes') return 'Yes';
  if (v === 'no') return 'No';
  if (v === 'low') return 'Low risk';
  if (v === 'medium') return 'Moderate risk';
  if (v === 'high') return 'High risk';
  if (v === 'safe') return 'Generally safe';
  if (v === 'caution') return 'Caution';
  if (v === 'unknown') return fallback;
  if (v === 'insufficient_data') return 'Need more data';
  return _titleCase(v.replace(/_/g, ' '));
}

function harmfulSeverityLabel(sev) {
  const v = String(sev || '').trim().toLowerCase();
  if (v === 'low') return 'Low risk';
  if (v === 'medium') return 'Moderate risk';
  if (v === 'high') return 'High risk';
  return 'Risk unknown';
}

function verdictBadgeTone(kind, answer) {
  const v = String(answer || '').trim().toLowerCase();
  if (kind === 'good') {
    if (v === 'yes') return 'good';
    if (v === 'no') return 'risk';
    return 'pending';
  }
  if (kind === 'harmful') {
    if (v === 'low') return 'good';
    if (v === 'medium') return 'warn';
    if (v === 'high') return 'risk';
    return 'pending';
  }
  if (kind === 'children') {
    if (v === 'safe') return 'good';
    if (v === 'caution') return 'warn';
    return 'pending';
  }
  return 'pending';
}

function deterministicGoodForMe(tiles, conflicts) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  if (list.length > 0) return `${list.length} routine conflict(s) detected — review before use.`;
  if (tiles?.key_actives?.status === 'available') return 'No profile conflicts detected from ingredient scan.';
  return 'Scan complete — add your profile for a personalised fit verdict.';
}

function deterministicHarmfulLine(watchList) {
  const list = Array.isArray(watchList) ? watchList : [];
  if (!list.length) return 'No flagged ingredients found in ingredient scan.';
  const labels = list
    .slice(0, 3)
    .map((w) => String(w?.label || '').trim())
    .filter(Boolean);
  return `${list.length} ingredient(s) flagged for review: ${labels.join(', ')}${list.length > 3 ? '…' : ''}.`;
}

function buildPendingText(reasoningReady) {
  return reasoningReady ? null : 'Deeper analysis running - results will update shortly';
}

/** Snapshot top-level `reasoning_state` wins; infer from `result_summary.reasoning` when absent (legacy rows). */
function resolveReasoningStateFromSnapshot(snapshot) {
  const top = String(snapshot?.reasoning_state || '').trim().toLowerCase();
  if (top === 'pending' || top === 'complete' || top === 'fallback' || top === 'disabled') return top;
  const st = String(snapshot?.result_summary?.reasoning?.status || '').trim().toLowerCase();
  if (st === 'pending') return 'pending';
  if (st === 'disabled') return 'disabled';
  return 'complete';
}

function normalizeEvidenceFlags(harmful) {
  const flags = Array.isArray(harmful?.flags) ? harmful.flags : [];
  return flags
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String(item.label || item.text || item.name || '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeAlternativesList(alt) {
  const candidates = Array.isArray(alt?.candidates) ? alt.candidates : [];
  return candidates
    .map((item) => (typeof item === 'string' ? item.trim() : String(item?.name || item?.title || '').trim()))
    .filter(Boolean)
    .slice(0, 4);
}

function formatReasoningEvidenceRef(ref) {
  const v = String(ref || '').trim();
  if (!v) return '';
  return v
    .split(':')
    .map((part) => part.replace(/[_-]/g, ' '))
    .map((part) => _titleCase(part))
    .join(' - ');
}

function verdictChipTone(label) {
  const t = String(label || '').toLowerCase();
  if (/no |detected|safe|within concern|fragrance-free|allergen/.test(t)) return 'good';
  if (/phenoxyethanol|preservative|caution|adult-targeted|retinoid|acid/.test(t)) return 'warn';
  if (/conflict|avoid|high risk|irritant|metal/.test(t)) return 'risk';
  return 'neutral';
}

function VerdictIcon({ type }) {
  const common = { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true };
  if (type === 'info') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 8v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="5.8" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (type === 'check') {
    return (
      <svg {...common}>
        <path d="M5.5 10.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'warning') {
    return (
      <svg {...common}>
        <path d="M10 4.2l6.1 10.6H3.9L10 4.2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 8v3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="13.8" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (type === 'person') {
    return (
      <svg {...common}>
        <circle cx="10" cy="6.4" r="2.1" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.8 15.2c.6-2.1 2.2-3.2 4.2-3.2s3.6 1.1 4.2 3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'flag') {
    return (
      <svg {...common}>
        <path d="M6 16V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6.7 4.8h6.3l-1.7 2.7 1.7 2.7H6.7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5.5 6.2h9M5.5 10h9M5.5 13.8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const TILE_ICON_VARIANT = {
  key_actives: 'teal',
  function: 'blue',
  skin_type: 'pink',
  formulation: 'amber',
  safety_score: 'rose'
};

function TileArticle({ title, tile, iconVariant = 'gray', layout = 'card' }) {
  const t = tile || {};
  const meta = formatTileMeta(t);
  const body =
    t.status === 'available'
      ? Array.isArray(t.value)
        ? t.value
            .map((v) => (typeof v === 'string' ? v : (v?.display || v?.name || JSON.stringify(v))))
            .join(', ')
        : String(t.value ?? '—')
      : formatTileBody(t) || '—';

  if (layout === 'safety') {
    const statusKey = String(t.status || 'unavailable');
    const deferred = statusKey === 'deferred' || statusKey === 'unavailable';
    const comingSoon = deferred;
    return (
      <article className={`arp-safety-tile arp-tile--${String(t.status || 'unavailable')}`}>
        <div className={`arp-tile-icon-mark arp-tile-icon--${iconVariant}`} aria-hidden />
        <div className="arp-safety-tile-main">
          <p className="arp-safety-tile-label">Safety score</p>
          <p className="arp-safety-tile-value">{body}</p>
          {meta ? <p className="arp-tile-meta">{meta}</p> : null}
          {!comingSoon ? (
            <div className="arp-safety-bar-wrap" aria-hidden={!deferred}>
              <div className="arp-safety-bar-fill" />
            </div>
          ) : null}
          {comingSoon ? <p className="arp-safety-pending-hint">Coming soon — safety score pipeline is not enabled for this scan</p> : null}
        </div>
      </article>
    );
  }

  return (
    <article className={`arp-tile arp-tile--${String(t.status || 'unavailable')}`}>
      <div className="arp-tile-inner">
        <span className={`arp-tile-icon-mark arp-tile-icon--${iconVariant}`} aria-hidden />
        <div className="arp-tile-copy">
          <p className="arp-tile-k">{title}</p>
          <p className="arp-tile-v">{body}</p>
          {meta ? <p className="arp-tile-meta">{meta}</p> : null}
        </div>
      </div>
    </article>
  );
}

function VerdictRow({
  iconClass,
  icon,
  q,
  badge = null,
  badgeTone = 'pending',
  summary = '',
  detail = '',
  chips = [],
  listItems = [],
  footer = '',
  pending = '',
  reasoning = null,
  children = null
}) {
  return (
    <div className={`arp-verdict-row ${iconClass.replace('arp-verdict-icon--', 'arp-verdict-row--')}`}>
      <div className={`arp-verdict-icon ${iconClass}`} aria-hidden>
        <VerdictIcon type={icon} />
      </div>
      <div className="arp-verdict-copy">
        <div className="arp-verdict-head">
          <p className="arp-verdict-q">{q}</p>
          {badge ? <span className={`arp-verdict-badge arp-verdict-badge--${badgeTone}`}>{badge}</span> : null}
        </div>
        <div className="arp-verdict-a">
          {summary ? <p className="arp-verdict-summary">{summary}</p> : null}
          {detail ? <p className="arp-verdict-why">{detail}</p> : null}
          {chips.length ? (
            <div className="arp-verdict-chip-row">
              {chips.map((chip, idx) => (
                <span key={`${chip}-${idx}`} className={`arp-verdict-chip arp-verdict-chip--${verdictChipTone(chip)}`}>
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
          {listItems.length ? (
            <ul className="arp-verdict-list">
              {listItems.map((item, idx) => (
                <li key={`${item}-${idx}`}>{item}</li>
              ))}
            </ul>
          ) : null}
          {footer ? <p className="arp-verdict-footer">{footer}</p> : null}
          {pending ? <p className="arp-verdict-pending">{pending}</p> : null}
          {reasoning ? (
            <div className="arp-reasoning-panel" aria-label="Why this answer">
              <div className="arp-reasoning-head">
                <span className="arp-reasoning-kicker">Why this answer</span>
                {reasoning.confidenceLabel ? (
                  <span className="arp-reasoning-badge">{reasoning.confidenceLabel}</span>
                ) : null}
              </div>
              {reasoning.summary ? <p className="arp-reasoning-copy">{reasoning.summary}</p> : null}
              {reasoning.evidenceRefs?.length ? (
                <div className="arp-reasoning-evidence">
                  {reasoning.evidenceRefs.map((ref, idx) => (
                    <span key={`${ref}-${idx}`} className="arp-reasoning-evidence-pill">
                      {ref}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Merge scan-line graph hits with session routine conflicts without dropping either. */
function mergeScanAndRoutineConflicts(product, snapshot) {
  const scan = Array.isArray(product?.ingredient_graph_conflicts) ? product.ingredient_graph_conflicts : [];
  const rout = Array.isArray(snapshot?.routine_conflicts) ? snapshot.routine_conflicts : [];
  const byId = new Map();
  for (const c of [...scan, ...rout]) {
    const id = c?.id != null ? String(c.id) : `h-${String(c.summary || '').slice(0, 48)}-${c.severity || ''}`;
    if (!byId.has(id)) byId.set(id, c);
  }
  return [...byId.values()];
}

/**
 * Snapshot conflicts use `summary`, `recommendation`, and optional `ingredient_canonical_ids`
 * (see reasoning-map-service routineConflictsFromGraphHits), not ingredient_a / ingredient_b.
 */
function normalizeConflictRows(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list.map((c) => {
    const ids = Array.isArray(c.ingredient_canonical_ids) ? c.ingredient_canonical_ids.filter(Boolean) : [];
    const ingredientA = c.ingredient_a || ids[0] || null;
    const ingredientB = c.ingredient_b || ids[1] || null;
    const notes = c.notes || c.summary || c.recommendation || '';
    const severity = String(c.severity || 'medium').toLowerCase();
    const mode = ingredientA && ingredientB ? 'pair' : 'summary';
    return { ...c, ingredient_a: ingredientA, ingredient_b: ingredientB, notes, severity, mode };
  });
}

// ─── Waitlist modal ───────────────────────────────────────────────────────────

function WaitlistModal({ onClose, productName, apiBase }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrMsg] = useState('');

  const submit = useCallback(async () => {
    if (!name.trim() || !email.trim()) {
      setErrMsg('Please enter your name and email.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrMsg('Please enter a valid email address.');
      return;
    }
    setStatus('loading');
    setErrMsg('');
    const base = normalizeHttpApiBase(apiBase);
    const url = base ? `${base}/api/public/waitlist` : '/api/public/waitlist';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          source: 'routine_builder',
          product: productName || null
        })
      });
      if (!res.ok) throw new Error('server');
      setStatus('success');
    } catch {
      setStatus('error');
      setErrMsg('Something went wrong — please try again.');
    }
  }, [name, email, productName, apiBase]);

  const onKey = (e) => e.key === 'Enter' && submit();

  return (
    <div
      className="wl-overlay"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="wl-card" role="dialog" aria-modal="true" aria-label="Join the routine builder waitlist">
        <button type="button" className="wl-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {status === 'success' ? (
          <div className="wl-success">
            <div className="wl-success-mark">✓</div>
            <h2 className="wl-title">You&apos;re on the list.</h2>
            <p className="wl-sub">
              We&apos;ll reach out to <strong>{email}</strong> when your personalised routine builder is ready.
            </p>
            <button type="button" className="wl-submit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <span className="wl-eyebrow">Coming soon</span>
            <h2 className="wl-title">
              Build your routine,
              <br />
              the smart way.
            </h2>
            <p className="wl-sub">
              We analyse your products, flag ingredient conflicts, and generate a personalised morning and evening
              routine for your skin goals.
            </p>

            <div className="wl-fields">
              <div className="wl-field">
                <label className="wl-label" htmlFor="wl-name">
                  First name
                </label>
                <input
                  id="wl-name"
                  className="wl-input"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={onKey}
                  autoFocus
                  autoComplete="given-name"
                />
              </div>
              <div className="wl-field">
                <label className="wl-label" htmlFor="wl-email">
                  Email address
                </label>
                <input
                  id="wl-email"
                  className="wl-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onKey}
                  autoComplete="email"
                />
              </div>
            </div>

            {errorMsg && (
              <p className="wl-error" role="alert">
                {errorMsg}
              </p>
            )}

            <button type="button" className="wl-submit" onClick={submit} disabled={status === 'loading'}>
              {status === 'loading' ? 'Joining…' : 'Join the waitlist'}
            </button>
            <p className="wl-privacy">No spam. Unsubscribe any time.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main results page ────────────────────────────────────────────────────────

export default function AssistantResultsPage({ snapshot, onClose, onAskKelly, onBack, apiBase }) {
  const summaryV1Enabled = String(process.env.REACT_APP_RESULTS_SUMMARY_V1 || '1').trim() !== '0';
  const [showWaitlist, setShowWaitlist] = useState(false);

  const sp = snapshot?.scanned_product;
  const pd = snapshot?.product;
  const product = sp ? { ...(pd || {}), ...sp } : pd || {};
  const productName = (sp?.product_name || sp?.name || pd?.product_name || pd?.name || product.product_name || product.name || '').trim();
  const productImage =
    pickFirstProductImageUrl(sp) || pickFirstProductImageUrl(pd) || pickFirstProductImageUrl(product) || null;
  const ingredientsText = sanitizeIngredientText(product.ingredients_text || '');
  const factsSource = product.source || snapshot?.scanned_product?.source || null;
  const rawConflicts = useMemo(() => mergeScanAndRoutineConflicts(product, snapshot), [product, snapshot]);
  const graphConflicts = useMemo(() => normalizeConflictRows(rawConflicts), [rawConflicts]);
  const confidencePct = Math.round((snapshot?.confidence?.global ?? 0.62) * 100);
  const hasProduct = !!productName;
  const notFound = String(snapshot?.scanned_product?.lookup_status || '') === 'not_found';
  const displayBarcode = String(sp?.barcode || pd?.barcode || product?.barcode || '').trim();
  const scanSummary = snapshot?.scan_summary || null;
  const resultSummary = snapshot?.result_summary || null;
  const legacyPreContract = !!resultSummary?.legacy_pre_contract;
  const tiles = summaryV1Enabled ? (resultSummary?.tiles || scanSummary?.tiles || null) : null;
  const verdict = summaryV1Enabled ? (resultSummary?.verdict || null) : null;
  const missingMore = Array.isArray(resultSummary?.missing_more) ? resultSummary.missing_more : [];
  const categoryRoute = String(
    snapshot?.scanned_product?.category_route || snapshot?.category_route || ''
  ).toLowerCase();
  const isCosmeticContext = categoryRoute === 'cosmetic' || categoryRoute === 'hygiene';
  const isFoodContext = categoryRoute === 'food' || categoryRoute === 'supplement';

  const handleHeaderBack = onBack || onClose;

  const { good, watch } = useMemo(
    () => (isCosmeticContext ? classifyIngredients(ingredientsText) : { good: [], watch: [] }),
    [ingredientsText, isCosmeticContext]
  );

  const hasData = good.length > 0 || watch.length > 0 || graphConflicts.length > 0;
  const sourceLine = catalogSourceLabel(factsSource);
  const ingredientsDisplay =
    ingredientsText.length > INGREDIENT_LIST_MAX_CHARS
      ? `${ingredientsText.slice(0, INGREDIENT_LIST_MAX_CHARS)}…`
      : ingredientsText;
  const conflLevel = graphConflicts.length > 0
    ? graphConflicts.some((c) => c.severity === 'critical')
      ? 'critical'
      : 'high'
    : null;
  const functionText = (() => {
    const v = tiles?.function?.value;
    if (Array.isArray(v)) return v.map((x) => String(x || '').replace(/_/g, ' ')).join(', ');
    return String(v || '').trim();
  })();
  const keyActiveTag = (() => {
    const v = tiles?.key_actives?.value;
    if (!Array.isArray(v) || !v.length) return null;
    const a = v[0];
    return typeof a === 'string' ? a : (a?.display || a?.name || null);
  })();
  const formulationTag = tiles?.formulation?.status === 'available'
    ? String(tiles?.formulation?.value || '')
    : null;
  const altBlock = verdict?.alternatives;
  const altSource = String(altBlock?.source || '').trim().toLowerCase();
  const isReasoningAlternatives = altSource === 'reasoning';
  const showAlternatives =
    shouldShowAlternativesCta(altBlock) &&
    (!isReasoningAlternatives || Number(altBlock?.reasoning?.confidence || 0) >= 0.76);
  const whatItDoes = verdict?.product_overview?.what_it_does || (functionText ? `Supports ${functionText}.` : 'Deterministic product summary.');
  const productTagline = String(sp?.generic_name || pd?.generic_name || product?.generic_name || '').trim();
  const heroSubText = productTagline || whatItDoes;
  const goodForMeAnswer = verdict?.good_for_me?.answer || 'unknown';
  const harmfulAnswer = verdict?.harmful?.severity || 'unknown';
  const childrenAnswer = verdict?.children_safe?.answer || 'insufficient_data';
  const childrenSafeSummary = verdict?.children_safe?.summary || verdict?.children_safe?.text || null;
  const sideEffectsLine = verdict ? sideEffectsDisplayText(verdict) : 'Not assessed in this scan.';
  const heroTaxonomyMetaLine = taxonomyHeroMetaLine(snapshot, categoryRoute, confidencePct);
  const heroMetaConfMod = heroMetaConfidenceMod(snapshot, confidencePct);
  const categoryPresentation = useMemo(
    () =>
      categoryRoutePresentation(
        snapshot?.scanned_product?.category_route || snapshot?.category_route,
        factsSource
      ),
    [snapshot?.scanned_product?.category_route, snapshot?.category_route, factsSource]
  );
  const isCosmeticPresentation = categoryPresentation.mod === 'cosmetic';
  const showCompactHeader = !notFound && (hasProduct || !!ingredientsText);
  const navScreenTitle = useMemo(() => {
    const m = categoryPresentation.mod;
    if (m === 'cosmetic') return 'Skincare analysis';
    /* Short nav label — category pill below repeats route (e.g. “Food & beverage”). */
    if (m === 'food') return 'Food scan';
    if (m === 'supplement') return 'Supplement scan';
    return 'Scan results';
  }, [categoryPresentation.mod]);
  const tileSectionHeading = useMemo(() => {
    if (categoryPresentation.mod === 'cosmetic') return 'Ingredients & Formulation';
    if (categoryPresentation.mod === 'food' || categoryPresentation.mod === 'supplement') return 'Ingredients';
    return 'Product composition';
  }, [categoryPresentation.mod]);

  const reasoningStateUi = resolveReasoningStateFromSnapshot(snapshot);
  const reasoningReady = reasoningStateUi !== 'pending';
  const pendingText =
    reasoningStateUi === 'pending' || reasoningStateUi === 'fallback'
      ? null
      : buildPendingText(!!verdict);
  const harmfulFlags = normalizeEvidenceFlags(verdict?.harmful);
  const harmfulEvidence = String(verdict?.harmful?.top_evidence || verdict?.harmful?.summary || '').trim();
  const alternativesList = normalizeAlternativesList(verdict?.alternatives);

  const fallbackWhatItDoes =
    whatItDoes ||
    (functionText ? `Supports ${functionText}.` : categoryRoute === 'food' ? 'Food or beverage item from the scanned catalog.' : 'Product summary is still loading.');
  const fallbackGoodSummary =
    verdict?.good_for_me?.summary ||
    deterministicGoodForMe(tiles, graphConflicts);
  const fallbackGoodAnswer =
    verdict?.good_for_me?.answer ||
    (graphConflicts.length ? 'caution' : good.length ? 'yes' : 'unknown');
  const fallbackHarmfulAnswer =
    verdict?.harmful?.severity ||
    (watch.length ? 'medium' : product?.nyc_metal_context ? 'low' : 'low');
  const fallbackHarmfulSummary =
    harmfulEvidence ||
    deterministicHarmfulLine(watch);
  const fallbackHarmfulFlags =
    harmfulFlags.length
      ? harmfulFlags
      : [
          ...(product?.nyc_metal_context ? ['NYC metals reference checked'] : []),
          ...(watch.slice(0, 3).map((item) => item.label))
        ].slice(0, 4);
  const fallbackChildrenAnswer =
    verdict?.children_safe?.answer ||
    (
      isCosmeticContext && (keyActiveTag || /retinol|acid|benzoyl peroxide/i.test(ingredientsText))
        ? 'caution'
        : 'insufficient_data'
    );
  const fallbackChildrenSummary =
    childrenSafeSummary ||
    (fallbackChildrenAnswer === 'caution'
      ? 'Active-focused formulas may be better suited for adult routines. Pediatric guidance was not confirmed in this scan.'
      : 'No pediatric-specific catalog guidance available yet.');
  const fallbackSideEffects =
    sideEffectsLine !== 'Not assessed in this scan.'
      ? sideEffectsLine
      : watch.length
        ? `Potential sensitivity around ${watch.slice(0, 2).map((item) => item.label).join(' and ')}.`
        : 'Not assessed in this scan.';
  const fallbackAlternativesFooter =
    alternativesList.length
      ? (isFoodContext
          ? 'Or ask Kelly for personalised food or supplement alternatives.'
          : 'Or ask Kelly for personalised alternatives based on your routine.')
      : (isFoodContext
          ? 'Ask Kelly for personalised food or supplement alternatives.'
          : 'Ask Kelly for personalised alternatives based on your routine.');
  const unresolvedFoodSignals = isFoodContext
    ? [
        String(tiles?.formulation?.confidence || '').toLowerCase() === 'low',
        String(tiles?.safety_score?.status || '').toLowerCase() !== 'available',
        sideEffectsLine === 'Not assessed in this scan.'
      ].filter(Boolean).length
    : 0;
  const routeTrustState = isFoodContext
    ? (unresolvedFoodSignals >= 2 ? 'deterministic_limited' : 'deterministic')
    : 'standard';
  const routeTrustSummary = isFoodContext
    ? (
        routeTrustState === 'deterministic_limited'
          ? 'Food route is using deterministic additive/dye checks for this scan; nutrition and safety scoring are not fully enabled yet.'
          : 'Food route is using deterministic additive/dye checks for this scan.'
      )
    : null;
  const showSafetyScoreTile = !(
    (categoryRoute === 'food' || categoryRoute === 'supplement') &&
    String(tiles?.safety_score?.reason_unavailable || '') === 'no_scoring_pipeline'
  );
  const resultReasoning = resultSummary?.reasoning || null;
  const reasoningMode = String(resultReasoning?.reasoning_mode || '').trim().toLowerCase();
  const showModelReasoningPanel = reasoningMode === 'model' && reasoningStateUi === 'complete';
  const reasoningConfidenceLabel = (n) => {
    const x = Number(n || 0);
    if (!Number.isFinite(x) || x <= 0) return '';
    if (x >= 0.85) return 'High confidence';
    if (x >= 0.72) return 'Medium confidence';
    return 'Low confidence';
  };
  const reasoningPanelFor = (field) => {
    if (!showModelReasoningPanel) return null;
    if (!field || String(field?.source || '') !== 'reasoning') return null;
    const refs = Array.isArray(field?.reasoning?.reasoning_evidence_refs)
      ? field.reasoning.reasoning_evidence_refs.map(formatReasoningEvidenceRef).filter(Boolean)
      : Array.isArray(resultReasoning?.reasoning_evidence_refs)
        ? resultReasoning.reasoning_evidence_refs.map(formatReasoningEvidenceRef).filter(Boolean)
        : [];
    return {
      confidenceLabel: reasoningConfidenceLabel(field?.reasoning?.confidence),
      summary: 'AI-assisted analysis',
      evidenceRefs: refs.slice(0, 4)
    };
  };

  return (
    <div className="arp-root" role="dialog" aria-label="Scan results">
      <header
        className={`arp-header${showCompactHeader ? ' arp-header--nav' : ''}`}
      >
        <button type="button" className="arp-back" onClick={handleHeaderBack} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M12 5L7 10L12 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {showCompactHeader ? (
          <p className="arp-nav-title-pill">{navScreenTitle}</p>
        ) : (
          <div className="arp-product-row">
            {productImage ? (
              <img className="arp-thumb" src={productImage} alt={productName || 'Product'} />
            ) : null}
            <div className="arp-product-text">
              <span className="arp-product-name">{hasProduct ? productName : 'Scanned product'}</span>
              <span className={`arp-confidence conf-${heroMetaConfMod}`}>
                <span className="arp-conf-dot" />
                {heroTaxonomyMetaLine || `Confidence ${confidencePct}%`}
              </span>
            </div>
          </div>
        )}
        {showCompactHeader ? (
          <button type="button" className="arp-nav-more" aria-label="More options">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <circle cx="4" cy="10" r="1.6" />
              <circle cx="10" cy="10" r="1.6" />
              <circle cx="16" cy="10" r="1.6" />
            </svg>
          </button>
        ) : null}
      </header>

      <main className="arp-body">
        <section className="arp-hero-card" aria-label="Hero summary card">
          {notFound ? (
            <>
              <div className="arp-hero-media arp-hero-media--stage">
                <div className="arp-hero-image arp-hero-image--fallback" aria-hidden="true">
                  <svg className="arp-hero-placeholder-icon" width="64" height="64" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="arp-hero-placeholder-label">No product photo</span>
                </div>
              </div>
              <div className="arp-hero-content">
                <span className="arp-category-pill arp-category-pill--unknown">Not in catalog</span>
                <h1 className="arp-hero-title">No match for this barcode</h1>
                <p className="arp-hero-sub">
                  {displayBarcode
                    ? `We could not find ${displayBarcode} in Open Beauty Facts or Open Food Facts. Try another scan or paste ingredients in chat.`
                    : 'Try another scan or paste ingredients in chat.'}
                </p>
                <div className="arp-hero-meta">
                  <span className="arp-confidence conf-mid">
                    <span className="arp-conf-dot" />
                    Catalog lookup
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="arp-hero-media arp-hero-media--stage">
                {productImage ? (
                  <img className="arp-hero-image" src={productImage} alt={productName || 'Product'} />
                ) : (
                  <div className="arp-hero-image arp-hero-image--fallback" aria-hidden="true">
                    <svg className="arp-hero-placeholder-icon" width="64" height="64" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="arp-hero-placeholder-label">No product photo</span>
                  </div>
                )}
                <div className="arp-floating-tags">
                  {keyActiveTag ? (
                    <span className="arp-tag-pill arp-tag-pill--hero">
                      <span className="arp-tag-dot arp-tag-dot--green" aria-hidden="true" />
                      {keyActiveTag}
                    </span>
                  ) : null}
                  {formulationTag ? (
                    <span className="arp-tag-pill arp-tag-pill--hero">
                      <span className="arp-tag-dot arp-tag-dot--blue" aria-hidden="true" />
                      {formulationTag}
                    </span>
                  ) : null}
                  {tiles?.safety_score?.status === 'deferred' ? (
                    <span className="arp-tag-pill arp-tag-pill--hero">
                      <span className="arp-tag-dot arp-tag-dot--amber" aria-hidden="true" />
                      Safety score coming soon
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="arp-hero-content">
                <span className={`arp-category-pill arp-category-pill--${categoryPresentation.mod}`}>
                  {categoryPresentation.label}
                </span>
                <h1 className="arp-hero-title">{hasProduct ? productName : 'Scanned product'}</h1>
                <p className="arp-hero-sub">{heroSubText}</p>
                <div className="arp-hero-meta">
                  <span className={`arp-confidence conf-${heroMetaConfMod}`}>
                    <span className="arp-conf-dot" />
                    {heroTaxonomyMetaLine || `Confidence ${confidencePct}%`}
                  </span>
                  {!heroTaxonomyMetaLine && sourceLine ? (
                    <>
                      <span className="arp-hero-meta-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="arp-hero-taxonomy">{sourceLine}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </section>

        {!ingredientsText && !hasProduct && !notFound ? (
          <div className="arp-empty">
            <div className="arp-empty-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="6" y="4" width="20" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 12h12M10 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="arp-empty-title">Ingredient analysis</p>
            <p className="arp-empty-sub">
              Hold a product label up to the camera. I&apos;ll tell you what works for your skin and what to watch out
              for.
            </p>
          </div>
        ) : null}

        {hasProduct && !ingredientsText && !notFound ? (
          <div className="arp-empty">
            <p className="arp-empty-title">No ingredient list yet</p>
            <p className="arp-empty-sub">
              We have this product name from your session, but no ingredient text. Scan again or paste ingredients in
              chat.
            </p>
          </div>
        ) : null}

        {tiles ? (
          <section
            className="arp-section"
            aria-label="Structured summary tiles"
            style={isFoodContext ? { order: 2 } : undefined}
          >
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-ref">◫</span>
              {tileSectionHeading}
            </h2>
            {isCosmeticContext ? (
              <div className="arp-tile-grid arp-tile-grid--quad">
                {[
                  ['key_actives', 'Key Actives'],
                  ['function', 'Function'],
                  ['skin_type', 'Skin Type'],
                  ['formulation', 'Formulation']
                ].map(([k, label]) => (
                  <TileArticle
                    key={k}
                    title={label}
                    tile={tiles?.[k]}
                    iconVariant={TILE_ICON_VARIANT[k] || 'gray'}
                  />
                ))}
              </div>
            ) : (
              <div className="arp-non-cosmetic-tile-summary">
                <p className="arp-ingredient-note arp-ingredient-note--muted">
                  Cosmetic analysis tiles are not applicable for this product category.
                </p>
                {tiles?.formulation ? (
                  <TileArticle
                    title="Formulation"
                    tile={tiles?.formulation}
                    iconVariant={TILE_ICON_VARIANT.formulation || 'amber'}
                  />
                ) : null}
              </div>
            )}
            {showSafetyScoreTile ? (
              <div className="arp-safety-row">
                <TileArticle
                  title="Safety score"
                  tile={tiles?.safety_score}
                  iconVariant={TILE_ICON_VARIANT.safety_score}
                  layout="safety"
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section
          className="arp-section"
          aria-label="Decision answers"
          style={isFoodContext ? { order: 1 } : undefined}
        >
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-warn">?</span>
              Decision answers
            </h2>
            {reasoningStateUi === 'pending' || reasoningStateUi === 'fallback' ? (
              <div
                className="arp-reasoning-global-banner"
                data-testid="arp-reasoning-state-banner"
                data-reasoning-state={reasoningStateUi}
                role="status"
                aria-live="polite"
              >
                {reasoningStateUi === 'pending'
                  ? 'Deeper analysis is running in the background. Verdict rows stay put; wording may refine when ready (no refresh needed).'
                  : 'Model reasoning stayed in a safe fallback for this scan. Answers below use catalogue facts and deterministic checks only.'}
              </div>
            ) : null}
            {routeTrustSummary ? (
              <p className="arp-ingredient-note arp-ingredient-note--muted">{routeTrustSummary}</p>
            ) : null}
            {legacyPreContract ? (
              <p className="arp-ingredient-note arp-ingredient-note--muted">
                Legacy session detected. Route-safe contract defaults were applied for compatibility.
              </p>
            ) : null}
            <div className="arp-verdict-block arp-verdict-block--stable">
              <VerdictRow
                iconClass="arp-verdict-icon--neutral"
                icon="info"
                q="What does it do?"
                summary={fallbackWhatItDoes}
              />
              <VerdictRow
                iconClass="arp-verdict-icon--good"
                icon="check"
                q="Is this good for me?"
                badge={formatVerdictAnswer(fallbackGoodAnswer, 'Needs more context')}
                badgeTone={verdictBadgeTone('good', fallbackGoodAnswer)}
                summary={fallbackGoodSummary}
                detail={!reasoningReady && graphConflicts.length === 0 ? 'Using deterministic scan signals until deeper reasoning is available.' : ''}
                pending={pendingText}
                reasoning={reasoningPanelFor(verdict?.good_for_me)}
              />
              <VerdictRow
                iconClass="arp-verdict-icon--risk"
                icon="warning"
                q="Harmful ingredients / risk"
                badge={harmfulSeverityLabel(fallbackHarmfulAnswer)}
                badgeTone={verdictBadgeTone('harmful', fallbackHarmfulAnswer)}
                summary={harmfulFlags.length && !harmfulEvidence ? fallbackHarmfulSummary : ''}
                detail={harmfulEvidence || (!harmfulFlags.length ? deterministicHarmfulLine(watch) : '')}
                chips={fallbackHarmfulFlags}
                pending={!harmfulFlags.length ? pendingText : ''}
                reasoning={reasoningPanelFor(verdict?.harmful)}
              />
              <VerdictRow
                iconClass="arp-verdict-icon--kids"
                icon="person"
                q="Good for children?"
                badge={formatVerdictAnswer(fallbackChildrenAnswer, 'Need more data')}
                badgeTone={verdictBadgeTone('children', fallbackChildrenAnswer)}
                summary={fallbackChildrenSummary}
                pending={pendingText}
                reasoning={reasoningPanelFor(verdict?.children_safe)}
              />
              <VerdictRow
                iconClass="arp-verdict-icon--fx"
                icon="flag"
                q="Side effects"
                summary={sideEffectsLine !== 'Not assessed in this scan.' ? fallbackSideEffects : ''}
                pending={
                  sideEffectsLine === 'Not assessed in this scan.'
                    ? 'Side effect profile not yet assessed for this scan.'
                    : pendingText
                }
                reasoning={reasoningPanelFor(verdict?.side_effects)}
              />
              <VerdictRow
                iconClass="arp-verdict-icon--alt"
                icon="list"
                q="Alternatives I can use"
                badge={alternativesList.length ? `${alternativesList.length} found` : null}
                badgeTone="alt"
                summary={!alternativesList.length
                  ? (isFoodContext
                      ? 'Ask Kelly for personalised food or supplement alternatives.'
                      : 'Ask Kelly for personalised alternatives based on your routine.')
                  : ''}
                listItems={alternativesList}
                footer={alternativesList.length ? fallbackAlternativesFooter : ''}
                pending={!alternativesList.length ? pendingText : ''}
                reasoning={reasoningPanelFor(verdict?.alternatives)}
              />
              <p className="arp-verdict-disclaimer">{formatDisclaimerLine(resultSummary?.disclaimer)}</p>
            </div>
          </section>

        {missingMore.length ? (
          <section className="arp-section" aria-label="Upgrade conversion layer">
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-good">✦</span>
              Get more from your scan
            </h2>
            <div className="arp-conversion-card">
              {missingMore.map((line, idx) => (
                <p key={`mm-${idx}`}>{line}</p>
              ))}
            </div>
          </section>
        ) : null}

        {ingredientsText && !notFound ? (
          <section className="arp-section arp-section--ingredient-list" aria-label="Catalog ingredient list">
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-list">≡</span>
              Full ingredient line
            </h2>
            {sourceLine ? <p className="arp-ingredient-source">From {sourceLine}</p> : null}
            <p className="arp-ingredient-note arp-ingredient-note--muted">
              {categoryRoute === 'food' || categoryRoute === 'supplement'
                ? 'Tiles above summarize route-safe catalog signals for this product type. This block is the complete ingredient line (authoritative for this scan).'
                : 'This is the full catalog ingredient line. The tiles above highlight structured signals; wording may differ from your package.'}
            </p>
            {!hasData && categoryRoute !== 'food' && categoryRoute !== 'supplement' ? (
              <p className="arp-ingredient-note">
                No common skincare actives were auto-highlighted from this text (minimal or non-cosmetic label).
              </p>
            ) : null}
            <pre className="arp-ingredients-raw">{ingredientsDisplay}</pre>
          </section>
        ) : null}

        {graphConflicts.length > 0 ? (
          <section className="arp-section">
            <h2 className="arp-section-heading">
              <span className={`arp-heading-icon icon-conflict icon-${conflLevel || 'high'}`}>!</span>
              {graphConflicts.length === 1 ? 'Conflict detected' : `${graphConflicts.length} conflicts detected`}
            </h2>
            <div className="arp-conflict-stack">
              {graphConflicts.slice(0, 6).map((c, i) =>
                c.mode === 'pair' ? (
                  <div key={c.id || i} className={`arp-conflict-card sev-${c.severity || 'high'}`}>
                    <div className="arp-conflict-pair">
                      <span className="arp-ing-pill">{_display(c.ingredient_a)}</span>
                      <span className="arp-conflict-plus">+</span>
                      <span className="arp-ing-pill">{_display(c.ingredient_b)}</span>
                      <span className={`arp-sev-badge sev-${c.severity || 'high'}`}>{c.severity || 'high'}</span>
                    </div>
                    {c.notes ? <p className="arp-conflict-note">{c.notes}</p> : null}
                    {c.recommendation && c.recommendation !== c.notes ? (
                      <p className="arp-conflict-note arp-conflict-note--muted">{c.recommendation}</p>
                    ) : null}
                  </div>
                ) : (
                  <div key={c.id || i} className={`arp-conflict-card sev-${c.severity || 'medium'}`}>
                    <div className="arp-conflict-pair">
                      <span className={`arp-sev-badge sev-${c.severity || 'medium'}`}>{c.severity || 'medium'}</span>
                    </div>
                    {c.notes ? <p className="arp-conflict-note">{c.notes}</p> : null}
                    {c.recommendation && c.recommendation !== c.notes ? (
                      <p className="arp-conflict-note arp-conflict-note--muted">{c.recommendation}</p>
                    ) : null}
                  </div>
                )
              )}
            </div>
          </section>
        ) : null}

        {isCosmeticPresentation && good.length > 0 ? (
          <section className="arp-section">
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-good">✓</span>
              Works for you
            </h2>
            <div className="arp-chip-grid">
              {good.map((item, i) => (
                <div key={`${item.label}-${i}`} className="arp-chip chip-good">
                  <span className="arp-chip-name">{item.label}</span>
                  <span className="arp-chip-sub">{item.benefit}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {isCosmeticPresentation && watch.length > 0 ? (
          <section className="arp-section">
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-warn">⚠</span>
              Heads up
            </h2>
            <div className="arp-chip-grid">
              {watch.map((item, i) => (
                <div key={`${item.label}-${i}`} className="arp-chip chip-warn">
                  <span className="arp-chip-name">{item.label}</span>
                  <span className="arp-chip-sub">{item.reason}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {isCosmeticPresentation && product?.nyc_metal_context ? (
          <section className="arp-section arp-section--nyc" aria-label="NYC Health Department reference metal tests">
            <h2 className="arp-section-heading">
              <span className="arp-heading-icon icon-ref">i</span>
              NYC reference — heavy metals
            </h2>
            <p className="arp-nyc-disclaimer">{product.nyc_metal_context.disclaimer}</p>
            <p className="arp-nyc-summary">{product.nyc_metal_context.summary}</p>
            <p className="arp-nyc-meta">
              Match: <strong>{String(product.nyc_metal_context.match_tier || '—')}</strong>
              {product.nyc_metal_context.dataset_version
                ? ` · Dataset: ${product.nyc_metal_context.dataset_version}`
                : null}
            </p>
            {Array.isArray(product.nyc_metal_context.metals) && product.nyc_metal_context.metals.length > 0 ? (
              <ul className="arp-nyc-metal-list">
                {product.nyc_metal_context.metals.map((m) => (
                  <li key={m.metal}>
                    <strong>{m.metal}</strong>
                    {m.n_reported > 0 && m.max_ppm != null ? (
                      <span>
                        {' '}
                        — up to {Number(m.max_ppm).toLocaleString()} ppm in {m.n_reported} NYC row(s) with a numeric
                        reading ({m.n_not_detected} not detected / not reported)
                      </span>
                    ) : (
                      <span> — no numeric readings in matched rows ({m.n_rows} row(s))</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {Array.isArray(product.nyc_metal_context.sample_rows) && product.nyc_metal_context.sample_rows.length > 0 ? (
              <div className="arp-nyc-samples">
                <h3 className="arp-nyc-samples-title">Example NYC-tested items (similar name)</h3>
                <ul className="arp-nyc-sample-list">
                  {product.nyc_metal_context.sample_rows.slice(0, 5).map((r, i) => (
                    <li key={`${r.product_name}-${i}`}>
                      <span className="arp-nyc-sample-name">{r.product_name}</span>
                      <span className="arp-nyc-sample-meta">
                        {' '}
                        · {r.metal}
                        {r.not_detected ? ' · not detected / not reported' : r.ppm != null ? ` · ${Number(r.ppm).toLocaleString()} ppm` : ''}
                        {r.collection_date ? ` · ${r.collection_date}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <footer className="arp-footer arp-footer--split" aria-label="Result actions">
        <button type="button" className="arp-cta-primary arp-cta-done" onClick={onClose}>
          Done
        </button>
        <button type="button" className="arp-cta-secondary" onClick={onAskKelly || onClose}>
          Ask Agent
        </button>
        {showAlternatives ? (
          <button type="button" className="arp-cta-tertiary" onClick={() => setShowWaitlist(true)}>
            See alternatives
          </button>
        ) : null}
      </footer>

      {showWaitlist ? (
        <WaitlistModal
          onClose={() => setShowWaitlist(false)}
          productName={productName || null}
          apiBase={apiBase}
        />
      ) : null}
    </div>
  );
}

function _display(id) {
  return String(id || '')
    .replace(/^cosing:/i, '')
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function _titleCase(str) {
  return String(str || '')
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
