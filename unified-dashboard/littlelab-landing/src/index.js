import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AssistantExperience from './AssistantExperience';
import {
  buildNavigatorPublicApiBases,
  middlewareApiBaseFromLocation,
  navigatorMetaHasNumericCounts,
  normalizeHttpApiBase,
  normalizePublicMetaJson
} from './landingAssistantApi';
import { computePlanMatchMeta, sortPlansByMode } from './planSort';
import './skin-care-tokens.css';
import './styles.css';
/** Doctor headshot for hero kicker (distinct from approved seal). Served from `public/images/branding/`. */
const doctorAvatarPng = '/images/branding/doc-avatar.png';

/** Routine-band / marketing bottle art (`public/images` → CRA `build`). New filename avoids stale cache on `routine-bottle.png`. */
const DEFAULT_ROUTINE_BOTTLE_IMAGE = '/images/products/effaclar-routine-bottle.png';
const DEFAULT_PAYOR_CARD_IMAGE =
  'https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=1200&q=80';
const FALLBACK_PAYOR_API_BASE = 'https://api.myskinandcare.com';
const PAYOR_THEME_IMAGES = {
  dental: [
    'https://images.unsplash.com/photo-1588776814546-daab30f310ce?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1600170311833-c2cf5280ce49?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1629909615957-be38be7f7db4?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1609207825181-e8f26f72d0d3?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1593022356769-11f762e25ed9?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1629909615762-4b8f8bb3557b?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1588774069162-3123e02d7f1f?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1571772996211-2f02c9727629?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1612277795421-9bc7706a4a41?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1629909615622-0f4a8e6b8931?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1629909615951-bc4f8f4b98f5?auto=format&fit=crop&w=1200&q=80'
  ],
  vision: [
    'https://images.unsplash.com/photo-1588776814546-ec7e6d8fb2f9?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1579684288361-5c1a2958f0de?auto=format&fit=crop&w=1200&q=80'
  ],
  hearing: [
    'https://images.unsplash.com/photo-1580281657527-47c0a9d228f5?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80'
  ],
  physio: [
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1599447421416-3414500d18a5?auto=format&fit=crop&w=1200&q=80'
  ],
  chiropractic: [
    'https://images.unsplash.com/photo-1580281658629-53f22f2eebf1?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1666214280557-f1b5022eb634?auto=format&fit=crop&w=1200&q=80'
  ],
  preventive: [
    'https://images.unsplash.com/photo-1631815589968-fdb09a223b1e?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1579154204601-01588f351e67?auto=format&fit=crop&w=1200&q=80'
  ],
  specialist: [
    'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1200&q=80'
  ],
  emergency: [
    'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1460672985063-6764ac8b9c74?auto=format&fit=crop&w=1200&q=80'
  ],
  hospital: [
    'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=1200&q=80'
  ],
  ambulance: [
    'https://images.unsplash.com/photo-1587745416684-47953f16f02f?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1603398938378-e54eab446dde?auto=format&fit=crop&w=1200&q=80'
  ],
  nursing_home: [
    'https://images.unsplash.com/photo-1584516150909-c43483ee7938?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1576765973907-3c8f5f9f6dbd?auto=format&fit=crop&w=1200&q=80'
  ],
  cancer: [
    'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=1200&q=80'
  ]
};
const GLOBAL_MEDICAL_IMAGE_POOL = Array.from(
  new Set([
    ...Object.values(PAYOR_THEME_IMAGES).flat(),
    DEFAULT_PAYOR_CARD_IMAGE
  ])
);
const LANDING_SEED_PAYOR_CARDS = [
  {
    id: 'seed-aetna',
    title: 'Aetna Medicare',
    star: 4.7,
    priceLine: 'From $0/mo',
    servicesLine: 'Dental, vision, hearing',
    image: PAYOR_THEME_IMAGES.preventive[0] || DEFAULT_PAYOR_CARD_IMAGE,
    moop: 4900,
    priorAuthCount: 1,
    confidence: 'estimated',
    coverageCount: 3,
    planType: 'HMO',
    yearlyCostLine: '$4,900',
    approvalLine: 'Low burden',
    warningLine: '',
    cardTag: 'Top Rated',
    engagementTags: ['Top quality', 'Dental included', 'Vision included'],
    coveredTagLabels: ['Dental', 'Vision', 'Hearing'],
    partialTagLabels: [],
    missingTagLabels: []
  },
  {
    id: 'seed-uhc',
    title: 'UnitedHealthcare',
    star: 4.5,
    priceLine: 'From $12/mo',
    servicesLine: 'Dental, specialist, preventive',
    image: PAYOR_THEME_IMAGES.specialist[0] || DEFAULT_PAYOR_CARD_IMAGE,
    moop: 5600,
    priorAuthCount: 2,
    confidence: 'estimated',
    coverageCount: 3,
    planType: 'PPO',
    yearlyCostLine: '$5,600',
    approvalLine: 'Medium burden',
    warningLine: '',
    cardTag: 'Popular',
    engagementTags: ['Low monthly cost', 'Preventive', 'Specialist'],
    coveredTagLabels: ['Dental', 'Specialist', 'Preventive'],
    partialTagLabels: [],
    missingTagLabels: []
  },
  {
    id: 'seed-humana',
    title: 'Humana Medicare',
    star: 4.6,
    priceLine: 'From $18/mo',
    servicesLine: 'Vision, hearing, preventive',
    image: PAYOR_THEME_IMAGES.vision[0] || DEFAULT_PAYOR_CARD_IMAGE,
    moop: 6400,
    priorAuthCount: 1,
    confidence: 'estimated',
    coverageCount: 3,
    planType: 'HMO-POS',
    yearlyCostLine: '$6,400',
    approvalLine: 'Low burden',
    warningLine: '',
    cardTag: 'Best Value',
    engagementTags: ['Vision included', 'Hearing included', 'Preventive'],
    coveredTagLabels: ['Vision', 'Hearing', 'Preventive'],
    partialTagLabels: [],
    missingTagLabels: []
  },
  {
    id: 'seed-bcbs',
    title: 'Blue Cross',
    star: 4.4,
    priceLine: 'From $24/mo',
    servicesLine: 'Dental, vision, hospital',
    image: PAYOR_THEME_IMAGES.hospital[0] || DEFAULT_PAYOR_CARD_IMAGE,
    moop: 6800,
    priorAuthCount: 2,
    confidence: 'estimated',
    coverageCount: 3,
    planType: 'PPO',
    yearlyCostLine: '$6,800',
    approvalLine: 'Medium burden',
    warningLine: '',
    cardTag: 'Popular',
    engagementTags: ['Dental included', 'Vision included', 'Hospital'],
    coveredTagLabels: ['Dental', 'Vision', 'Hospital'],
    partialTagLabels: [],
    missingTagLabels: []
  }
];

const STAR_BANDS = [
  { id: '4.5+', label: '★★★★★', min: 4.5 },
  { id: '4+', label: '★★★★☆+', min: 4 },
  { id: '3+', label: '★★★☆☆+', min: 3 },
  { id: '1-2.9', label: '★', min: 1, max: 2.9 }
];

const PLAN_STYLE_OPTIONS = [
  { id: 'hmo', label: 'Lower cost provider network' },
  { id: 'ppo', label: 'Higher cost provider network' },
  { id: 'pos', label: 'Primary care provider' },
  { id: 'snp', label: 'Chronic care plan' }
];

function formatNavigatorDbCount(v) {
  if (v == null || Number.isNaN(Number(v)) || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString();
}

/** Large counts (benefit rows): compact when very large, else full locale string. */
function formatNavigatorTrustPrimaryStat(v) {
  if (v == null || Number.isNaN(Number(v)) || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 100000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(n);
  }
  return n.toLocaleString();
}

/** Secondary stat (contracts): always readable full number like the reference mock. */
function formatNavigatorTrustSecondaryStat(v) {
  if (v == null || Number.isNaN(Number(v)) || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString();
}

function navigatorTodayLongEnUs() {
  try {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (_) {
    return new Date().toDateString();
  }
}

/** Prefer distinct MA contracts for "plans compared"; fall back to premium table row count. */
function navigatorPlansComparedCountFromMeta(m) {
  if (!m || m.fetch_error) return null;
  const dc = m.distinct_contract_ids;
  const pr = m.payor_plan_premiums_row_count;
  if (dc != null && Number.isFinite(Number(dc))) return Number(dc);
  if (pr != null && Number.isFinite(Number(pr))) return Number(pr);
  return null;
}

function publicPlansEndpointCandidates(base, routeWithLeadingSlash) {
  const safeRoute = String(routeWithLeadingSlash || '').startsWith('/') ? String(routeWithLeadingSlash) : `/${String(routeWithLeadingSlash || '')}`;
  const prefixes = ['/api/public/plans', '/public/plans'];
  return prefixes.map((prefix) => (base ? `${base}${prefix}${safeRoute}` : `${prefix}${safeRoute}`));
}

async function fetchPublicPlansJsonWithFallback(base, routeWithLeadingSlash, query = '') {
  const endpoints = publicPlansEndpointCandidates(base, routeWithLeadingSlash);
  let lastResponse = null;
  let lastData = {};
  for (const endpoint of endpoints) {
    const target = query ? `${endpoint}?${query}` : endpoint;
    let res = null;
    let data = {};
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      res = await fetch(target, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      data = await res.json().catch(() => ({}));
    } catch (_) {
      continue;
    }
    lastResponse = res;
    lastData = data;
    // If endpoint is missing on this host, try next route shape.
    if (res.status === 404 || res.status === 304) continue;
    return { res, data };
  }
  return { res: lastResponse, data: lastData };
}

function publicGeoEndpointCandidates(base, routeWithLeadingSlash) {
  const safeRoute = String(routeWithLeadingSlash || '').startsWith('/') ? String(routeWithLeadingSlash) : `/${String(routeWithLeadingSlash || '')}`;
  const prefixes = ['/api/public/geo', '/public/geo'];
  return prefixes.map((prefix) => (base ? `${base}${prefix}${safeRoute}` : `${prefix}${safeRoute}`));
}

async function fetchPublicGeoJsonWithFallback(base, routeWithLeadingSlash) {
  const endpoints = publicGeoEndpointCandidates(base, routeWithLeadingSlash);
  let lastResponse = null;
  let lastData = {};
  for (const endpoint of endpoints) {
    let res = null;
    let data = {};
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      res = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      data = await res.json().catch(() => ({}));
    } catch (_) {
      continue;
    }
    lastResponse = res;
    lastData = data;
    if (res.status === 404) continue;
    return { res, data };
  }
  return { res: lastResponse, data: lastData };
}

function formatNeedLabel(needKey) {
  const normalized = String(needKey || '').trim().toLowerCase();
  const overrides = {
    chiro: 'Chiropractic',
    chiropractic: 'Chiropractic',
    nursing_home: 'Nursing home'
  };
  if (overrides[normalized]) return overrides[normalized];
  const raw = normalized.replace(/_/g, ' ').trim();
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function shuffledCopy(list) {
  const out = Array.isArray(list) ? list.slice() : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function formatCurrencyValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return `$${Math.round(n).toLocaleString()}`;
}

function buildStarRatingVisual(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return { filled: '☆☆☆☆☆', empty: '', numeric: 'N/A' };
  }
  const clamped = Math.max(0, Math.min(5, n));
  const filledCount = Math.max(0, Math.min(5, Math.round(clamped)));
  const emptyCount = Math.max(0, 5 - filledCount);
  return {
    filled: '★'.repeat(filledCount),
    empty: '☆'.repeat(emptyCount),
    numeric: clamped.toFixed(1)
  };
}

function emitCheckoutFunnelEvent(name, detail) {
  try {
    if (typeof window !== 'undefined' && Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...(detail || {}) });
    }
    window.dispatchEvent(new CustomEvent('checkout-funnel', { detail: { name, ...(detail || {}) } }));
  } catch (_) {}
}

/** Newsletter-style waitlist capture on the landing page (same API as assistant waitlist). */
function GetAppWaitlistOverlay({ open, onClose, apiBaseCandidates }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setEmail('');
      setStatus('idle');
      setErrMsg('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
    const base = normalizeHttpApiBase(apiBaseCandidates[0] || '');
    const url = base ? `${base}/api/public/waitlist` : '/api/public/waitlist';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          source: 'landing_get_app',
          product: null
        })
      });
      if (!res.ok) throw new Error('server');
      setStatus('success');
      emitCheckoutFunnelEvent('landing_waitlist_joined', { source: 'get_app_overlay' });
    } catch {
      setStatus('error');
      setErrMsg('Something went wrong — please try again.');
    }
  }, [name, email, apiBaseCandidates]);

  if (!open) return null;

  return (
    <div
      className="get-app-overlay"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="get-app-card" role="dialog" aria-modal="true" aria-labelledby="get-app-title">
        <button type="button" className="get-app-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {status === 'success' ? (
          <>
            <p className="get-app-eyebrow">You&apos;re in</p>
            <h2 id="get-app-title" className="get-app-title">
              Thanks, {name.trim().split(/\s+/)[0]}.
            </h2>
            <p className="get-app-sub">
              We&apos;ll email <strong>{email}</strong> when the Somo app is ready to download.
            </p>
            <button type="button" className="get-app-submit" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="get-app-eyebrow">Get The App</p>
            <h2 id="get-app-title" className="get-app-title">
              Join the waitlist
            </h2>
            <p className="get-app-sub">
              Be first to scan products, see ingredients, and build routines when we launch. One short form — no
              extra page.
            </p>
            <div className="get-app-fields">
              <label className="get-app-label" htmlFor="get-app-name">
                Name
              </label>
              <input
                id="get-app-name"
                className="get-app-input"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label className="get-app-label" htmlFor="get-app-email">
                Email
              </label>
              <input
                id="get-app-email"
                className="get-app-input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </div>
            {errMsg ? (
              <p className="get-app-error" role="alert">
                {errMsg}
              </p>
            ) : null}
            <button type="button" className="get-app-submit" onClick={submit} disabled={status === 'loading'}>
              {status === 'loading' ? 'Sending…' : 'Join the waitlist'}
            </button>
            <p className="get-app-privacy">No spam. Unsubscribe any time.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function FindCareCoveragePage({ apiBaseCandidates, isLocalHost, localPatientAuthHref }) {
  const initialParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const showMedicareHowItWorks = initialParams?.get('doc') === 'how-it-works';
  const isResultsPage = typeof window !== 'undefined' &&
    !showMedicareHowItWorks &&
    (window.location.pathname === '/results' || initialParams?.get('view') === 'results');
  const [location, setLocation] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState({ zip: '', state: '', county: '' });
  const [zip, setZip] = useState('');
  const [sortBy, setSortBy] = useState('premium');
  const [strictNeedsOnly, setStrictNeedsOnly] = useState(false);
  const [selectedNeeds, setSelectedNeeds] = useState([]);
  const [filterState, setFilterState] = useState({
    costBands: [],
    monthlyMax: '',
    starBands: [],
    planStyles: [],
    maxYearlyCost: '',
    approvalNeeded: false,
    state: '',
    county: ''
  });
  const [geoOptions, setGeoOptions] = useState({
    zipOptions: [],
    stateOptions: [],
    countyOptions: [],
    countyByState: {}
  });
  const [zipGeoCandidates, setZipGeoCandidates] = useState([]);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showNeedsMenu, setShowNeedsMenu] = useState(false);
  const [showFiltersSheet, setShowFiltersSheet] = useState(false);
  const [showCompareDrawer, setShowCompareDrawer] = useState(false);
  const [hideMobileStickySearch, setHideMobileStickySearch] = useState(false);
  const [compactMobileStickySearch, setCompactMobileStickySearch] = useState(false);
  const [selectedPayor, setSelectedPayor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [zipFallbackInfo, setZipFallbackInfo] = useState(null);
  const [searchScopeMeta, setSearchScopeMeta] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [searched, setSearched] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [activePlanId, setActivePlanId] = useState('');
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const [activeResultsSurface, setActiveResultsSurface] = useState('details');
  const [flippedPayorId, setFlippedPayorId] = useState('');
  const [resultErrorType, setResultErrorType] = useState('');
  const [visibleResultCount, setVisibleResultCount] = useState(15);
  const [showZipInlineEdit, setShowZipInlineEdit] = useState(false);
  const [zipDraft, setZipDraft] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth <= 1024 : false)
  );
  const buildStamp = useMemo(() => String(process.env.REACT_APP_BUILD_STAMP || 'local-dev'), []);
  const textScale = 'large';
  const resultsRef = useRef(null);
  const comparePanelRef = useRef(null);
  const featuredCardsFetchRef = useRef({ inFlight: false, lastKey: '', lastFetchedAt: 0 });
  const lastMobileScrollYRef = useRef(0);
  const zipResolutionRequestIdRef = useRef(0);

  const commitZip = useCallback((rawZip) => {
    const nextZip = String(rawZip || '').replace(/[^\d]/g, '').slice(0, 5);
    zipResolutionRequestIdRef.current += 1;
    setZip(nextZip);
    setZipGeoCandidates([]);
    setResolvedLocation({ zip: nextZip, state: '', county: '' });
    setFilterState((prev) => ({ ...prev, state: '', county: '' }));
    setLocationStatus(nextZip ? 'resolving' : 'idle');
    return nextZip;
  }, []);

  const planStyleLabelMap = useMemo(() => {
    return PLAN_STYLE_OPTIONS.reduce((acc, option) => {
      acc[option.id] = option.label;
      return acc;
    }, {});
  }, []);
  const topFilters = [
    { id: 'dental', label: 'Dental', icon: 'tooth' },
    { id: 'vision', label: 'Vision', icon: 'eye' },
    { id: 'hearing', label: 'Hearing', icon: 'ear' },
    { id: 'physio', label: 'Physio', icon: 'sparkles' },
    { id: 'high-stars', label: '★ Top rated', icon: 'star' },
    { id: 'zero-premium', label: '$0 premium', icon: 'dollar' }
  ];
  const FilterIcon = ({ name }) => {
    const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
    if (name === 'star') return <svg {...common}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.1L12 17.4 6.4 20l1.1-6.1L3 9.6l6.2-.9Z"/></svg>;
    if (name === 'dollar') return <svg {...common}><path d="M12 3v18"/><path d="M16.5 7.5c0-1.9-1.8-3.5-4.5-3.5S7.5 5.6 7.5 7.5c0 5 9 2 9 7 0 1.9-1.8 3.5-4.5 3.5s-4.5-1.6-4.5-3.5"/></svg>;
    if (name === 'sparkles') return <svg {...common}><path d="m12 3 1.3 3.2L16.5 7.5l-3.2 1.3L12 12l-1.3-3.2L7.5 7.5l3.2-1.3Z"/><path d="m5 14 .8 1.9L7.7 17l-1.9.8L5 19.7l-.8-1.9L2.3 17l1.9-.8Z"/><path d="m19 13 .9 2.2L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.8Z"/></svg>;
    if (name === 'tooth') return <svg {...common}><path d="M8.2 4.5c1.2 0 2 .6 3.8.6s2.6-.6 3.8-.6c2 0 3.2 1.8 3.2 3.9 0 4.1-2 8.1-4 8.1-1.1 0-1.3-2.1-2.9-2.1s-1.8 2.1-2.9 2.1c-2 0-4-4-4-8.1 0-2.1 1.2-3.9 3-3.9Z"/></svg>;
    if (name === 'eye') return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>;
    if (name === 'ear') return <svg {...common}><path d="M17 9a5 5 0 1 0-10 0c0 2 1.2 3.5 2.8 4.6.9.6 1.2 1.2 1.2 2.1V17"/><path d="M12 21a3 3 0 0 0 3-3v-1"/><path d="M12 12.5c.8-.3 1.5-1 1.5-2a1.5 1.5 0 0 0-3 0"/></svg>;
    if (name === 'sliders') return <svg {...common}><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2"/></svg>;
    if (name === 'calendar-dollar') return <svg {...common}><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M7 3.5v4"/><path d="M17 3.5v4"/><path d="M3.5 10h17"/><path d="M12 12.5v5"/><path d="M14 14c0-.9-.9-1.5-2-1.5s-2 .6-2 1.5c0 2.2 4 1 4 3.2 0 .9-.9 1.5-2 1.5s-2-.6-2-1.5"/></svg>;
    return <svg {...common}><path d="m12 21c4.5-4.2 7-7.3 7-10.3A7 7 0 1 0 5 10.7c0 3 2.5 6.1 7 10.3Z"/><circle cx="12" cy="10.5" r="2.2"/></svg>;
  };
  const devUiStamp = useMemo(() => {
    if (process.env.NODE_ENV === 'production') return '';
    const configuredTag = String(process.env.REACT_APP_UI_VERSION || process.env.REACT_APP_BUILD_ID || '').trim();
    if (configuredTag) return `DEV UI ${configuredTag}`;
    const loadedAt = new Date().toLocaleTimeString([], { hour12: false });
    return `DEV UI loaded ${loadedAt}`;
  }, []);
  const resolveLocation = useCallback((raw) => {
    const input = String(raw || '').trim();
    const zipMatch = input.match(/\b\d{5}\b/);
    if (zipMatch) return { zip: zipMatch[0], state: '', county: '' };
    return null;
  }, []);
  const supportedNeedOptions = [
    { id: 'dental', label: 'Dental' },
    { id: 'vision', label: 'Vision' },
    { id: 'hearing', label: 'Hearing' },
    { id: 'physio', label: 'Physio' },
    { id: 'chiro', label: 'Chiropractic' },
    { id: 'preventive', label: 'Preventive' },
    { id: 'specialist', label: 'Specialist' },
    { id: 'emergency', label: 'Emergency' },
    { id: 'hospital', label: 'Hospital' },
    { id: 'ambulance', label: 'Ambulance' },
    { id: 'nursing_home', label: 'Nursing home' }
  ];
  const supportedNeedIds = useMemo(
    () => new Set(supportedNeedOptions.map((need) => need.id)),
    [supportedNeedOptions]
  );
  const normalizeNeedSelection = useCallback((rawNeeds) => {
    const rawList = Array.isArray(rawNeeds)
      ? rawNeeds
      : String(rawNeeds || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const normalized = [];
    const seen = new Set();
    rawList.forEach((value) => {
      const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      const canonical = key === 'chiropractic' ? 'chiro' : key;
      if (!supportedNeedIds.has(canonical) || seen.has(canonical)) return;
      seen.add(canonical);
      normalized.push(canonical);
    });
    return normalized;
  }, [supportedNeedIds]);
  const locationFilterData = geoOptions;
  const zipScopedStateOptions = useMemo(() => {
    if (!zipGeoCandidates.length) return [];
    return Array.from(new Set(zipGeoCandidates.map((c) => String(c?.state || '').trim().toUpperCase()).filter(Boolean))).sort();
  }, [zipGeoCandidates]);
  const zipScopedCountyByState = useMemo(() => {
    if (!zipGeoCandidates.length) return {};
    return zipGeoCandidates.reduce((acc, candidate) => {
      const state = String(candidate?.state || '').trim().toUpperCase();
      const county = String(candidate?.county || '').trim();
      if (!state || !county) return acc;
      if (!acc[state]) acc[state] = [];
      if (!acc[state].includes(county)) acc[state].push(county);
      return acc;
    }, {});
  }, [zipGeoCandidates]);
  // Only force ZIP-scoped state/county options when the ZIP is ambiguous.
  // For exact ZIP (or manual state/county search), keep full dropdowns available.
  const shouldUseZipScopedLocationOptions = locationStatus === 'ambiguous_zip';
  const effectiveStateOptions = shouldUseZipScopedLocationOptions && zipScopedStateOptions.length
    ? zipScopedStateOptions
    : locationFilterData.stateOptions;
  const effectiveCountyByState = shouldUseZipScopedLocationOptions && Object.keys(zipScopedCountyByState).length
    ? zipScopedCountyByState
    : locationFilterData.countyByState;
  const effectiveCountyOptions = useMemo(() => {
    if (!filterState.state) return [];
    return effectiveCountyByState[filterState.state] || [];
  }, [effectiveCountyByState, filterState.state]);
  const effectiveZipOptions = useMemo(() => {
    const base = Array.isArray(locationFilterData.zipOptions) ? locationFilterData.zipOptions.slice() : [];
    const currentZip = String(zip || '').replace(/[^\d]/g, '').slice(0, 5);
    if (/^\d{5}$/.test(currentZip) && !base.includes(currentZip)) {
      return [currentZip, ...base];
    }
    return base;
  }, [locationFilterData.zipOptions, zip]);
  const [geoDiagnostics, setGeoDiagnostics] = useState(null);
  const geoDataDegraded = useMemo(
    () => Boolean(geoDiagnostics && geoDiagnostics.is_complete === false),
    [geoDiagnostics]
  );
  const geoIssueSummary = useMemo(() => {
    const issues = Array.isArray(geoDiagnostics?.issues) ? geoDiagnostics.issues : [];
    if (!issues.length) return '';
    if (issues.includes('distinct_zip_count_below_threshold')) return 'ZIP mapping coverage is below release threshold.';
    if (issues.includes('states_with_counties_count_below_threshold')) return 'State/county coverage is below release threshold.';
    if (issues.includes('missing_zip_county_crosswalk')) return 'ZIP crosswalk table is missing.';
    return 'Geo mapping data is incomplete.';
  }, [geoDiagnostics]);
  const [featuredPayorCards, setFeaturedPayorCards] = useState(LANDING_SEED_PAYOR_CARDS);
  /** `idle` | `loading` | `ready` | `error` — featured rail uses API data only. */
  const [featuredCardsStatus, setFeaturedCardsStatus] = useState('ready');
  /** Row counts from GET /api/public/plans/meta (SQLite CMS tables). */
  const [planDatasetMeta, setPlanDatasetMeta] = useState(null);
  const normalizePayorName = useCallback((rawName) => {
    const clean = String(rawName || '').trim();
    const lower = clean.toLowerCase();
    if (!clean) return '';
    if (lower.includes('unitedhealth')) return 'UnitedHealthcare';
    if (lower.includes('aetna')) return 'Aetna';
    if (lower.includes('humana')) return 'Humana';
    if (lower.includes('cigna')) return 'Cigna';
    if (lower.includes('anthem')) return 'Anthem Blue Cross';
    if (lower.includes('blue cross') || lower.includes('blue shield')) return 'Blue Cross';
    return clean.replace(/\s+(medicare|fide|hide|plan|plans)$/i, '').trim();
  }, []);
  const imageForCard = useCallback((payerName, coveredTags, idx, usedImages = new Set(), options = {}) => {
    const tags = (Array.isArray(coveredTags) ? coveredTags : []).map((t) => String(t || '').toLowerCase());
    const hasTag = (needle) => tags.some((tag) => tag.includes(needle));
    const strictNoRepeat = Boolean(options.strictNoRepeat);
    const sanitizeImageCandidate = (url) => {
      const candidate = String(url || '').trim();
      if (!candidate) return '';
      if (candidate.startsWith('https://images.unsplash.com/')) return candidate;
      return '';
    };
    const seededPick = (pool, seedLabel) => {
      if (!pool.length) return '';
      const seed = `${payerName || ''}-${idx}-${seedLabel || 'seed'}`;
      let hash = 0;
      for (let i = 0; i < seed.length; i += 1) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
      const unseen = pool.filter((candidate) => !usedImages.has(candidate));
      const source = strictNoRepeat ? unseen : pool;
      if (!source.length) return '';
      const start = hash % source.length;
      const candidate = sanitizeImageCandidate(source[start]);
      if (!candidate) return '';
      usedImages.add(candidate);
      return candidate;
    };
    const pickFromCategory = (category) => {
      const pool = PAYOR_THEME_IMAGES[category] || [];
      const candidate = seededPick(pool, category);
      if (candidate) return candidate;
      if (!strictNoRepeat) {
        // Non-strict mode can cycle category images once local pool is exhausted.
        return seededPick(pool.length ? pool : GLOBAL_MEDICAL_IMAGE_POOL, `${category}-cycle`);
      }
      return seededPick(GLOBAL_MEDICAL_IMAGE_POOL, `${category}-global`);
    };
    const pickGlobal = (seedLabel) => seededPick(GLOBAL_MEDICAL_IMAGE_POOL, seedLabel);
    if (hasTag('dental')) return pickFromCategory('dental');
    if (hasTag('vision')) return pickFromCategory('vision');
    if (hasTag('hearing')) return pickFromCategory('hearing');
    if (hasTag('cancer') || hasTag('oncology')) return pickFromCategory('cancer');
    if (hasTag('physio') || hasTag('therapy') || hasTag('rehab')) return pickFromCategory('physio');
    if (hasTag('chiro')) return pickFromCategory('chiropractic');
    if (hasTag('hospital')) return pickFromCategory('hospital');
    if (hasTag('ambulance')) return pickFromCategory('ambulance');
    if (hasTag('nursing')) return pickFromCategory('nursing_home');
    if (hasTag('emergency')) return pickFromCategory('emergency');
    if (hasTag('specialist')) return pickFromCategory('specialist');
    if (hasTag('preventive')) return pickFromCategory('preventive');
    return pickGlobal('global-default') || DEFAULT_PAYOR_CARD_IMAGE;
  }, []);


  const selectedNeedLabel = useMemo(() => {
    if (!selectedNeeds.length) return 'Select needs';
    if (selectedNeeds.length <= 2) {
      const labels = supportedNeedOptions
        .filter((opt) => selectedNeeds.includes(opt.id))
        .map((opt) => opt.label);
      return labels.join(', ');
    }
    return `${selectedNeeds.length} needs selected`;
  }, [selectedNeeds, supportedNeedOptions]);
  const canRunSearch = useMemo(() => {
    if (!selectedNeeds.length) return false;
    const hasZip = Boolean(String(zip || '').trim());
    if (locationStatus === 'resolving') return false;
    if (locationStatus === 'exact_zip') return true;
    const hasState = Boolean(String(filterState.state || '').trim());
    const hasCounty = Boolean(String(filterState.county || '').trim());
    if (locationStatus === 'ambiguous_zip') return hasState && hasCounty;
    if (locationStatus === 'unresolved_zip') return hasState;
    if (hasState && hasCounty) return true;
    if (hasState) return true;
    return hasZip;
  }, [filterState.county, filterState.state, locationStatus, selectedNeeds.length, zip]);
  const showZipUnmappedHint = useMemo(() => {
    const hasZip = Boolean(String(zip || '').trim());
    const hasCountyScopeInput = Boolean(String(filterState.state || '').trim() && String(filterState.county || '').trim());
    const scopeAlreadyCounty = String(searchScopeMeta?.scopeUsed || '').toLowerCase() === 'county';
    return locationStatus === 'unresolved_zip' && hasZip && !hasCountyScopeInput && !scopeAlreadyCounty;
  }, [filterState.county, filterState.state, locationStatus, searchScopeMeta?.scopeUsed, zip]);

  const classifyResultErrorType = useCallback((msg) => {
    const text = String(msg || '').toLowerCase();
    if (!text) return '';
    if (text.includes('endpoint not found') || text.includes('404')) return 'endpoint';
    if (text.includes('still loading') || text.includes('data_ready')) return 'loading';
    if (text.includes('failed to fetch') || text.includes('network') || text.includes('timeout')) return 'network';
    return 'generic';
  }, []);

  const executeSearch = useCallback(async (zipOverride = '') => {
    setSearched(true);
    setError('');
    setResultErrorType('');
    const loc =
      typeof window !== 'undefined' && window.location ? { hostname: window.location.hostname } : null;
    const bases = buildNavigatorPublicApiBases(apiBaseCandidates, loc);

    try {
      setLoading(true);
      setResults([]);
      setSearchScopeMeta(null);
      const searchZip = String(zipOverride || zip).trim();
      if (!selectedNeeds.length) throw new Error('Pick at least one need.');
      let locationType = 'zip';
      const normalizedState = String(filterState.state || '').trim().toUpperCase();
      const normalizedCounty = String(filterState.county || '').trim();
      if (normalizedState && normalizedCounty) {
        locationType = 'county';
      } else if (normalizedState) {
        locationType = 'state';
      } else if (locationStatus === 'exact_zip') {
        locationType = 'zip';
      } else {
        if (!searchZip) throw new Error('Enter ZIP code or choose state/county to search plans.');
        locationType = 'zip';
      }
      if (locationType === 'zip' && locationStatus === 'ambiguous_zip' && !(normalizedState && normalizedCounty)) {
        throw new Error('This ZIP maps to multiple counties. Select county to continue.');
      }
      const params = new URLSearchParams({ sort_by: sortBy, location_type: locationType });
      if (locationType === 'zip') params.set('zip', searchZip);
      if (normalizedState) params.set('state', normalizedState);
      if (normalizedCounty) params.set('county', normalizedCounty);
      params.set('needs', selectedNeeds.join(','));
      if (selectedPayor.trim()) params.set('payor', selectedPayor.trim());
      let lastError = null;
      let endpointMissCount = 0;
      let successfulBaseCount = 0;
      let plans = [];
      let nextZipFallbackInfo = null;
      let nextScopeMeta = null;
      for (const base of bases) {
        try {
          const { res, data } = await fetchPublicPlansJsonWithFallback(base, '/search', params.toString());
          if (!res.ok || data?.success === false) {
            const msg = String(data?.message || data?.error || 'Plan search failed');
            if (res.status === 404 || msg.toLowerCase().includes('endpoint not found')) {
              endpointMissCount += 1;
              continue;
            }
            if (msg.includes('server_error') || msg.includes('no such table')) {
              throw new Error('Plan data is still loading. Please try again shortly.');
            }
            throw new Error(msg);
          }
          successfulBaseCount += 1;
          if (!nextZipFallbackInfo && data?.zip_geo_fallback && typeof data.zip_geo_fallback === 'object') {
            nextZipFallbackInfo = data.zip_geo_fallback;
          }
          if (!nextScopeMeta && data && typeof data === 'object') {
            nextScopeMeta = {
              scopeRequested: data.scope_requested || null,
              scopeUsed: data.scope_used || null,
              precision: data.precision || null
            };
          }
          if (data?.data_ready === false) {
            throw new Error(data?.message || 'Plan data is still loading. Please try again shortly.');
          }
          const nextPlans = Array.isArray(data?.plans) ? data.plans : Array.isArray(data?.results) ? data.results : [];
          if (nextPlans.length) {
            plans = nextPlans;
            break;
          }
          if (selectedNeeds.length > 1) {
            const partialBatches = await Promise.all(selectedNeeds.map(async (needId) => {
              const partialParams = new URLSearchParams({ sort_by: 'coverage', needs: String(needId), location_type: locationType });
              if (locationType === 'zip') partialParams.set('zip', searchZip);
              if (normalizedState) partialParams.set('state', normalizedState);
              if (normalizedCounty) partialParams.set('county', normalizedCounty);
              if (selectedPayor.trim()) partialParams.set('payor', selectedPayor.trim());
              const partialResponse = await fetchPublicPlansJsonWithFallback(base, '/search', partialParams.toString());
              if (!partialResponse?.res?.ok) return [];
              const partialData = partialResponse?.data || {};
              return Array.isArray(partialData?.plans) ? partialData.plans : [];
            }));
            const partialPlans = partialBatches.flat();
            if (partialPlans.length) {
              const deduped = [];
              const seen = new Set();
              partialPlans.forEach((plan) => {
                const key = String(plan.contract_id || plan.id || '');
                if (!key || seen.has(key)) return;
                seen.add(key);
                deduped.push({ ...plan, _partial_only: true });
              });
              plans = deduped;
              break;
            }
          }
          lastError = new Error('No plans found for this area yet.');
        } catch (err) {
          lastError = err;
        }
      }
      if (!plans.length && endpointMissCount > 0 && successfulBaseCount === 0) {
        throw new Error('Plan API endpoint not found. Check API base/backend deployment for /api/public/plans/search.');
      }
      if (!plans.length && lastError) {
        throw lastError;
      }
      setResults(plans);
      setZipFallbackInfo(nextZipFallbackInfo);
      setSearchScopeMeta(nextScopeMeta);
    } catch (err) {
      setResults([]);
      setZipFallbackInfo(null);
      setSearchScopeMeta(null);
      const nextMessage = String(err?.message || 'Search failed');
      setError(nextMessage);
      setResultErrorType(classifyResultErrorType(nextMessage));
    } finally {
      setLoading(false);
    }
  }, [apiBaseCandidates, classifyResultErrorType, filterState.county, filterState.state, locationStatus, selectedNeeds, selectedPayor, sortBy, zip]);

  const navigateToResults = useCallback((payorOverride = '', overrideFilters = null, overrideLocation = null) => {
    const params = new URLSearchParams();
    const nextNeeds = selectedNeeds.length ? selectedNeeds : ['dental', 'vision'];
    const nextZip = String(overrideLocation?.zip || zip || resolvedLocation.zip || '').trim();
    const nextLocationText = String(overrideLocation?.location ?? location ?? '').trim();
    const nextResolvedState = String(overrideLocation?.state || resolvedLocation.state || '').trim();
    const nextResolvedCounty = String(overrideLocation?.county || resolvedLocation.county || '').trim();
    if (nextZip) params.set('zip', nextZip);
    if (nextLocationText) params.set('location', nextLocationText);
    if (nextResolvedState) params.set('state', nextResolvedState);
    if (nextResolvedCounty) params.set('county', nextResolvedCounty);
    params.set('needs', nextNeeds.join(','));
    params.set('sort_by', sortBy);
    params.set('view', 'results');
    const nextFilterState = overrideFilters?.filterState || filterState;
    const nextTopFilters = Array.isArray(overrideFilters?.topFilters) ? overrideFilters.topFilters : [];
    if (nextTopFilters.length) params.set('filters', nextTopFilters.join(','));
    if (Number.isFinite(Number(nextFilterState.monthlyMax))) params.set('monthly_max', String(nextFilterState.monthlyMax));
    if (nextFilterState.starBands.length) params.set('stars', nextFilterState.starBands.join(','));
    if (nextFilterState.planStyles.length) params.set('plan_style', nextFilterState.planStyles.join(','));
    if (nextFilterState.maxYearlyCost) params.set('max_yearly_cost', String(nextFilterState.maxYearlyCost));
    if (nextFilterState.approvalNeeded) params.set('approval_needed', '1');
    if (strictNeedsOnly) params.set('strict_needs_only', '1');
    if (nextFilterState.state) params.set('state', nextFilterState.state);
    if (nextFilterState.county) params.set('county', nextFilterState.county);
    const nextPayor = payorOverride || selectedPayor;
    if (nextPayor) params.set('payor', nextPayor);
    const targetUrl = `/?${params.toString()}`;
    if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
      window.location.assign(targetUrl);
      return;
    }
    window.location.href = targetUrl;
  }, [filterState, location, resolvedLocation, selectedNeeds, selectedPayor, sortBy, strictNeedsOnly, zip]);

  const handleSearchClick = useCallback(() => {
    if (!selectedNeeds.length) {
      setError('Pick at least one need.');
      return;
    }
    if (isResultsPage) {
      const draftedZip = String(zipDraft || '').trim();
      const hasPendingDraftZip = /^\d{5}$/.test(draftedZip) && draftedZip !== String(zip || '').trim();
      if (hasPendingDraftZip) {
        const committedZip = commitZip(draftedZip);
        setShowZipInlineEdit(false);
        void executeSearch(committedZip);
        return;
      }
      if (!zip.trim()) {
        setError('Enter ZIP code to search plans.');
        return;
      }
      void executeSearch();
      return;
    }
    if (!location.trim()) {
      setError('Enter a location to continue.');
      return;
    }
    const resolved = resolveLocation(location);
    if (!resolved) {
      setError('Please enter a valid 5-digit ZIP code.');
      return;
    }
    const nextZip = String(resolved.zip || '').trim();
    const nextLocationText = String(location || '').trim();
    const nextResolvedLocation = { zip: nextZip, state: '', county: '' };
    setResolvedLocation(nextResolvedLocation);
    commitZip(nextZip);
    setFilterState((prev) => ({ ...prev, state: '', county: '' }));
    navigateToResults('', null, {
      zip: nextZip,
      location: nextLocationText,
      state: '',
      county: ''
    });
  }, [commitZip, executeSearch, isResultsPage, location, navigateToResults, resolveLocation, selectedNeeds, zip, zipDraft]);

  const fetchPlanDatasetMeta = useCallback(async () => {
    const loc =
      typeof window !== 'undefined' && window.location ? { hostname: window.location.hostname } : null;
    const bases = buildNavigatorPublicApiBases(apiBaseCandidates, loc);
    for (const base of bases) {
      try {
        const { res, data: raw } = await fetchPublicPlansJsonWithFallback(base, '/meta');
        const data = normalizePublicMetaJson(raw);
        if (res.ok && data && data.success !== false) {
          const hasCounts = navigatorMetaHasNumericCounts(data);
          const hasMissingInfo = Array.isArray(data.missing_tables) && data.missing_tables.length;
          if (hasCounts || hasMissingInfo) {
            setPlanDatasetMeta(data);
            return;
          }
        }
      } catch (_) {
        /* try next base */
      }
    }
    setPlanDatasetMeta({ success: false, data_ready: false, fetch_error: true });
  }, [apiBaseCandidates]);

  const fetchGeoOptions = useCallback(async () => {
    const loc =
      typeof window !== 'undefined' && window.location ? { hostname: window.location.hostname } : null;
    const bases = buildNavigatorPublicApiBases(apiBaseCandidates, loc);
    for (const base of bases) {
      try {
        const { res, data } = await fetchPublicGeoJsonWithFallback(base, '/options');
        if (!res?.ok || !data || data.success === false) continue;
        const next = {
          zipOptions: Array.isArray(data.zip_options) ? data.zip_options.map((v) => String(v || '').trim()).filter(Boolean) : [],
          stateOptions: Array.isArray(data.state_options) ? data.state_options.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean) : [],
          countyOptions: Array.isArray(data.county_options) ? data.county_options.map((v) => String(v || '').trim()).filter(Boolean) : [],
          countyByState: data.county_by_state && typeof data.county_by_state === 'object' ? data.county_by_state : {}
        };
        setGeoOptions(next);
        setGeoDiagnostics(data.geo_diagnostics && typeof data.geo_diagnostics === 'object' ? data.geo_diagnostics : null);
        return;
      } catch (_) {
        /* try next base */
      }
    }
    setGeoDiagnostics({ is_complete: false, issues: ['geo_options_fetch_failed'] });
  }, [apiBaseCandidates]);

  const fetchZipGeoResolution = useCallback(async (zipValue) => {
    const cleanZip = String(zipValue || '').replace(/[^\d]/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(cleanZip)) {
      return { zip: cleanZip, resolved: null, candidates: [], ambiguous: false, success: false };
    }
    const loc =
      typeof window !== 'undefined' && window.location ? { hostname: window.location.hostname } : null;
    const bases = buildNavigatorPublicApiBases(apiBaseCandidates, loc);
    for (const base of bases) {
      try {
        const { res, data } = await fetchPublicGeoJsonWithFallback(base, `/zip/${cleanZip}`);
        if (res?.ok && data?.success !== false) {
          return {
            zip: cleanZip,
            resolved: data?.resolved || null,
            candidates: Array.isArray(data?.candidates) ? data.candidates : [],
            ambiguous: Boolean(data?.ambiguous),
            success: true
          };
        }
      } catch (_) {
        /* try next base */
      }
    }
    return { zip: cleanZip, resolved: null, candidates: [], ambiguous: false, success: false };
  }, [apiBaseCandidates]);

  const fetchFeaturedPayorCards = useCallback(async () => {
    const loc =
      typeof window !== 'undefined' && window.location ? { hostname: window.location.hostname } : null;
    const bases = buildNavigatorPublicApiBases(apiBaseCandidates, loc);
    const sampleStates = ['CA', 'TX', 'FL', 'NY', 'NJ', 'PA', 'IL', 'GA', 'NC', 'AZ', 'OH', 'MI', 'VA', 'WA', 'MA', 'CO'];
    const defaultNeeds = selectedNeeds.length ? selectedNeeds : ['dental', 'vision', 'specialist', 'preventive'];
    const requestKey = `pipeline-sample|${defaultNeeds.slice().sort().join(',')}|v1`;
    const now = Date.now();
    const isRecentlyFetched =
      featuredCardsFetchRef.current.lastKey === requestKey &&
      now - featuredCardsFetchRef.current.lastFetchedAt < 5 * 60 * 1000;
    if (featuredCardsFetchRef.current.inFlight || isRecentlyFetched) return;
    try {
      featuredCardsFetchRef.current.inFlight = true;
      setFeaturedCardsStatus('loading');
      const querySets = [
        { sort_by: 'highest_stars', needs: defaultNeeds },
        { sort_by: 'lowest_moop', needs: defaultNeeds },
        { sort_by: 'lowest_premium', needs: defaultNeeds },
        { sort_by: 'premium', needs: defaultNeeds.slice().reverse() }
      ];
      const shuffledStates = shuffledCopy(sampleStates);
      const plansByPayer = new Map();
      const uniquePayerTarget = 12;
      for (const base of bases) {
        for (const state of shuffledStates) {
          for (const query of querySets) {
            const params = new URLSearchParams({
              location_type: 'state',
              state,
              sort_by: query.sort_by,
              limit: '50',
              needs: query.needs.join(',')
            });
            const { res, data } = await fetchPublicPlansJsonWithFallback(base, '/search', params.toString());
            if (!res?.ok || data?.success === false || data?.data_ready === false) continue;
            const batch = Array.isArray(data?.plans) ? data.plans : [];
            for (const plan of batch) {
              const payerKey = normalizePayorName(plan?.payer_name);
              if (!payerKey) continue;
              if (!plansByPayer.has(payerKey)) plansByPayer.set(payerKey, []);
              plansByPayer.get(payerKey).push(plan);
            }
            if (plansByPayer.size >= uniquePayerTarget) break;
          }
          if (plansByPayer.size >= uniquePayerTarget) break;
        }
        if (plansByPayer.size >= uniquePayerTarget) break;
      }
      if (!plansByPayer.size) {
        if (!featuredPayorCards.length) setFeaturedPayorCards(LANDING_SEED_PAYOR_CARDS);
        setFeaturedCardsStatus('ready');
        featuredCardsFetchRef.current.lastKey = requestKey;
        featuredCardsFetchRef.current.lastFetchedAt = now;
        return;
      }
      const cardOverrides = shuffledCopy(Array.from(plansByPayer.entries())
        .map(([payerName, payerPlans]) => {
          const best = payerPlans
            .slice()
            .sort((a, b) => {
              const starDiff = Number(b.star_rating || 0) - Number(a.star_rating || 0);
              if (starDiff !== 0) return starDiff;
              return Number(a.monthly_premium || 9999) - Number(b.monthly_premium || 9999);
            })[0];
          const coveredCounts = new Map();
          for (const p of payerPlans) {
            for (const [key, detail] of Object.entries(p?.coverage_detail || {})) {
              if (detail?.covered !== true) continue;
              coveredCounts.set(key, (coveredCounts.get(key) || 0) + 1);
            }
          }
          const coveredTags = Array.from(coveredCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k]) => String(k))
            .slice(0, 8);
          return {
            payerName,
            star: Number(best?.star_rating || 0),
            premium: Number(best?.monthly_premium || 0),
            coveredTags,
            moop: Number(best?.moop_amount || Number.NaN),
            confidence: String(best?.confidence || ''),
            coverageDetail: best?.coverage_detail || {},
            planType: String(best?.plan_type || '')
          };
        })
        .sort((a, b) => b.star - a.star));

      if (!cardOverrides.length) {
        if (!featuredPayorCards.length) setFeaturedPayorCards(LANDING_SEED_PAYOR_CARDS);
        setFeaturedCardsStatus('ready');
        featuredCardsFetchRef.current.lastKey = requestKey;
        featuredCardsFetchRef.current.lastFetchedAt = now;
        return;
      }
      const usedImages = new Set();
      const nextCards = cardOverrides.map((item, idx) => {
        const priorAuthCount = Object.values(item.coverageDetail || {}).filter((d) => d?.prior_auth === true).length;
        const allNeedKeys = defaultNeeds.map((need) => String(need || '').toLowerCase());
        const unmatchedNeedKeys = allNeedKeys.filter((need) => !(item.coverageDetail?.[need]?.covered === true));
        const yearlyCostLine = Number.isFinite(item.moop) ? `$${Math.round(item.moop).toLocaleString()}` : 'N/A';
        const approvalLine = priorAuthCount === 0
          ? 'Low burden'
          : priorAuthCount <= 2
            ? 'Medium burden'
            : 'High burden';
        const warningLine = unmatchedNeedKeys.length
          ? `Missing: ${unmatchedNeedKeys.slice(0, 2).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}`
          : '';
        const coverageTagsReadable = item.coveredTags
          .map((key) => key.replace(/_/g, ' '))
          .map((label) => label.charAt(0).toUpperCase() + label.slice(1));
        const missingTagsReadable = unmatchedNeedKeys
          .map((key) => key.replace(/_/g, ' '))
          .map((label) => label.charAt(0).toUpperCase() + label.slice(1));
        const partialTagsReadable = Object.entries(item.coverageDetail || {})
          .filter(([, detail]) => detail?.covered === true && detail?.prior_auth === true)
          .map(([key]) => String(key || '').replace(/_/g, ' '))
          .map((label) => label.charAt(0).toUpperCase() + label.slice(1));
        const engagementTags = [];
        if (Number(item.star || 0) >= 4.7) engagementTags.push('Top quality');
        if (Number(item.premium || 0) <= 40) engagementTags.push('Low monthly cost');
        if (item.coveredTags.includes('dental')) engagementTags.push('Dental included');
        if (item.coveredTags.includes('vision')) engagementTags.push('Vision included');
        if (item.coveredTags.includes('hearing')) engagementTags.push('Hearing included');
        for (const coverageTag of coverageTagsReadable) {
          if (engagementTags.length >= 6) break;
          if (!engagementTags.includes(coverageTag)) engagementTags.push(coverageTag);
        }
        if (!engagementTags.length) engagementTags.push('Easy to understand');
        const coverageFallbackFromEngagement = engagementTags
          .map((label) => String(label || '').replace(/\sincluded$/i, '').trim())
          .filter((label) => !/^(top quality|low monthly cost|easy to understand)$/i.test(label))
          .slice(0, 2);
        const coverageFallbackFromServices = String(item.coveredTags.join(', ') || '')
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label) => label.charAt(0).toUpperCase() + label.slice(1))
          .slice(0, 2);
        const coveredTagLabels = coverageTagsReadable.slice(0, 4);
        const partialTagLabels = partialTagsReadable.slice(0, 3);
        const missingTagLabels = missingTagsReadable.slice(0, 4);
        const heroImage =
          imageForCard(item.payerName, item.coveredTags, idx, usedImages, { strictNoRepeat: idx < 8 }) ||
          DEFAULT_PAYOR_CARD_IMAGE;
        return {
          id: item.payerName,
          title: item.payerName,
          star: Number(item.star || 0),
          priceLine: `From $${Number(item.premium || 0).toFixed(0)}/mo`,
          servicesLine: item.coveredTags.length > 0 ? item.coveredTags.join(', ') : 'Coverage from search results',
          image: heroImage,
          moop: Number.isFinite(item.moop) ? item.moop : null,
          priorAuthCount,
          confidence: item.confidence || null,
          coverageCount: item.coveredTags.length,
          planType: item.planType || 'Plan',
          yearlyCostLine,
          approvalLine,
          warningLine,
          cardTag: Number(item.star || 0) >= 4.7 ? 'Top Rated' : Number(item.premium || 0) <= 40 ? 'Best Value' : 'Popular',
          engagementTags: engagementTags.slice(0, 6),
          coveredTagLabels: coveredTagLabels.length ? coveredTagLabels : (coverageFallbackFromEngagement.length ? coverageFallbackFromEngagement : coverageFallbackFromServices),
          partialTagLabels,
          missingTagLabels
        };
      });
      const mergedCards = [...nextCards];
      if (mergedCards.length < 4) {
        for (const seed of LANDING_SEED_PAYOR_CARDS) {
          if (mergedCards.some((card) => card.id === seed.id || card.title === seed.title)) continue;
          mergedCards.push(seed);
          if (mergedCards.length >= 4) break;
        }
      }
      setFeaturedPayorCards(mergedCards);
      setFeaturedCardsStatus('ready');
      featuredCardsFetchRef.current.lastKey = requestKey;
      featuredCardsFetchRef.current.lastFetchedAt = now;
    } catch (_) {
      if (!featuredPayorCards.length) setFeaturedPayorCards(LANDING_SEED_PAYOR_CARDS);
      setFeaturedCardsStatus('error');
    } finally {
      featuredCardsFetchRef.current.inFlight = false;
    }
  }, [apiBaseCandidates, featuredPayorCards.length, imageForCard, normalizePayorName, selectedNeeds]);

  const payorRails = useMemo(() => {
    if (!featuredPayorCards.length) return [];
    const topRatedSource = featuredPayorCards
      .filter((c) => Number(c.star || 0) >= 4.5)
      .slice()
      .sort((a, b) => Number(b.star || 0) - Number(a.star || 0));
    if (topRatedSource.length) {
      const filler = featuredPayorCards
        .slice()
        .sort((a, b) => Number(b.star || 0) - Number(a.star || 0))
        .filter((card) => !topRatedSource.some((t) => t.id === card.id));
      const blendedTopRated = [...topRatedSource, ...filler].slice(0, 12);
      return [{ id: 'top-rated', title: 'Top rated', cards: blendedTopRated }];
    }
    const preview = featuredPayorCards
      .slice()
      .sort((a, b) => Number(b.star || 0) - Number(a.star || 0))
      .slice(0, 12);
    return preview.length ? [{ id: 'preview', title: 'Plans from your preview search', cards: preview }] : [];
  }, [featuredPayorCards]);

  const gallerySectionTitle = useMemo(() => {
    const rail = payorRails[0];
    if (!rail) return 'Sample plans from our pipeline';
    if (rail.id === 'top-rated') return 'Top rated sample plans';
    if (rail.id === 'preview') return 'Sample plans from our pipeline';
    return rail.title;
  }, [payorRails]);

  const landingPreviewMeta = useMemo(() => {
    if (isResultsPage) return '';
    return 'Randomized across multiple states';
  }, [isResultsPage]);

  const exactMatchResults = useMemo(() => {
    if (!results.length) return [];
    const anyStarBandMatch = (stars) => {
      if (!filterState.starBands.length) return true;
      return filterState.starBands.some((id) => {
        const band = STAR_BANDS.find((b) => b.id === id);
        if (!band) return false;
        if (Number.isFinite(band.max)) return stars >= band.min && stars <= band.max;
        return stars >= band.min;
      });
    };
    return results.filter((plan) => {
      const payorName = String(plan.payer_name || '').toLowerCase();
      const stars = Number(plan.star_rating || 0);
      const premium = Number(plan.monthly_premium || 0);
      const moop = Number(plan.moop_amount || Number.MAX_SAFE_INTEGER);
      const priorAuthCount = Object.values(plan.coverage_detail || {}).filter((d) => d?.prior_auth === true).length;
      const coverage = plan.coverage_detail || {};
      const covered = (key) => coverage?.[key]?.covered === true;
      const planType = String(plan.plan_type || '').toLowerCase();
      const confidence = String(plan.confidence || '').toLowerCase();

      if (filterState.monthlyMax !== '' && Number.isFinite(Number(filterState.monthlyMax)) && premium > Number(filterState.monthlyMax)) return false;
      if (!anyStarBandMatch(stars)) return false;
      if (filterState.maxYearlyCost && moop > Number(filterState.maxYearlyCost)) return false;
      for (const needId of selectedNeeds) {
        if (!covered(needId)) return false;
      }
      if (filterState.approvalNeeded && priorAuthCount === 0) return false;
      if (filterState.planStyles.length && !filterState.planStyles.some((style) => planType.includes(style))) return false;
      if (selectedPayor && !payorName.includes(selectedPayor.toLowerCase())) return false;
      return true;
    });
  }, [filterState, results, selectedNeeds, selectedPayor]);

  const displayedResults = useMemo(
    () => sortPlansByMode(exactMatchResults, sortBy, selectedNeeds),
    [exactMatchResults, selectedNeeds, sortBy]
  );

  const computePriorAuthBurden = useCallback((plan) => {
    const count = Object.values(plan?.coverage_detail || {}).filter((detail) => detail?.prior_auth === true).length;
    if (count === 0) return 'Low burden - no pre-approval required.';
    if (count <= 2) return 'Medium burden - some services may need pre-approval.';
    return 'High burden - many services may need pre-approval.';
  }, []);

  const closestPartialResults = useMemo(() => {
    if (!results.length || exactMatchResults.length) return [];
    const narrowed = results.filter((plan) => {
      const payorName = String(plan.payer_name || '').toLowerCase();
      const stars = Number(plan.star_rating || 0);
      const premium = Number(plan.monthly_premium || 0);
      const moop = Number(plan.moop_amount || Number.MAX_SAFE_INTEGER);
      const priorAuthCount = Object.values(plan.coverage_detail || {}).filter((d) => d?.prior_auth === true).length;
      const planType = String(plan.plan_type || '').toLowerCase();
      if (filterState.monthlyMax !== '' && Number.isFinite(Number(filterState.monthlyMax)) && premium > Number(filterState.monthlyMax)) return false;
      if (filterState.maxYearlyCost && moop > Number(filterState.maxYearlyCost)) return false;
      if (filterState.approvalNeeded && priorAuthCount === 0) return false;
      if (filterState.planStyles.length && !filterState.planStyles.some((style) => planType.includes(style))) return false;
      if (selectedPayor && !payorName.includes(selectedPayor.toLowerCase())) return false;
      return true;
    });
    return narrowed
      .filter((plan) => computePlanMatchMeta(plan, selectedNeeds).matchedCount > 0)
      .slice();
  }, [exactMatchResults.length, filterState, results, selectedNeeds, selectedPayor]);

  const displayedPartialResults = useMemo(
    () => sortPlansByMode(closestPartialResults, sortBy, selectedNeeds),
    [closestPartialResults, selectedNeeds, sortBy]
  );

  const renderedResults = displayedResults.length
    ? displayedResults
    : (strictNeedsOnly ? [] : displayedPartialResults);
  const hasNoExactMatches = searched && !loading && !error && displayedResults.length === 0 && displayedPartialResults.length > 0;
  const noResultsAtAll = searched && !loading && !error && renderedResults.length === 0;
  const activePlan = useMemo(() => {
    const id = String(activePlanId || '').trim();
    if (!id) return null;
    return renderedResults.find((plan) => String(plan.contract_id || '').trim() === id) || null;
  }, [activePlanId, renderedResults]);

  useEffect(() => {
    if (showPlanDetails && !activePlan) {
      setShowPlanDetails(false);
    }
  }, [activePlan, showPlanDetails]);

  const comparePlans = useMemo(() => {
    const selected = new Set(compareIds);
    return renderedResults.filter((p) => selected.has(p.contract_id)).slice(0, 2);
  }, [compareIds, renderedResults]);

  useEffect(() => {
    if (comparePlans.length === 2) {
      setActiveResultsSurface('compare');
    } else if (showPlanDetails) {
      setActiveResultsSurface('details');
    }
  }, [comparePlans.length, showPlanDetails]);

  const compareCoverageInsights = useMemo(() => {
    if (comparePlans.length !== 2) return { sharedMissing: [], onlyA: [], onlyB: [] };
    const [planA, planB] = comparePlans;
    const sharedMissing = [];
    const onlyA = [];
    const onlyB = [];
    selectedNeeds.forEach((needId) => {
      const aCovered = planA.coverage_detail?.[needId]?.covered === true;
      const bCovered = planB.coverage_detail?.[needId]?.covered === true;
      if (!aCovered && !bCovered) sharedMissing.push(formatNeedLabel(needId));
      else if (aCovered && !bCovered) onlyA.push(formatNeedLabel(needId));
      else if (!aCovered && bCovered) onlyB.push(formatNeedLabel(needId));
    });
    return { sharedMissing, onlyA, onlyB };
  }, [comparePlans, selectedNeeds]);
  const shouldShowDecisionSurface = comparePlans.length === 2 || (showPlanDetails && activePlan);
  const shouldInlineDecisionSurface = shouldShowDecisionSurface && isMobileViewport;
  const mobileDecisionAnchorIndex = useMemo(() => {
    if (!shouldInlineDecisionSurface) return -1;
    if (activeResultsSurface === 'compare' && comparePlans.length === 2) {
      const compareIdsSet = new Set(comparePlans.map((p) => String(p?.contract_id || '')));
      let maxIdx = -1;
      renderedResults.forEach((plan, idx) => {
        if (compareIdsSet.has(String(plan?.contract_id || ''))) maxIdx = Math.max(maxIdx, idx);
      });
      return maxIdx;
    }
    const activeId = String(activePlanId || '').trim();
    if (!activeId) return -1;
    return renderedResults.findIndex((plan) => String(plan?.contract_id || '').trim() === activeId);
  }, [activePlanId, activeResultsSurface, comparePlans, renderedResults, shouldInlineDecisionSurface]);
  const decisionSurfaceVisibleCount = shouldInlineDecisionSurface && mobileDecisionAnchorIndex >= 0
    ? mobileDecisionAnchorIndex + 1
    : visibleResultCount;
  const activePlanStarVisual = useMemo(
    () => buildStarRatingVisual(activePlan?.star_rating || 0),
    [activePlan]
  );

  const planSummary = useMemo(() => {
    if (!renderedResults.length) {
      return { count: 0, avgPremium: 0, highConfidence: 0, avgExposure: 0 };
    }
    const premiums = renderedResults
      .map((p) => Number(p.monthly_premium))
      .filter((v) => Number.isFinite(v));
    const moops = renderedResults
      .map((p) => Number(p.moop_amount))
      .filter((v) => Number.isFinite(v));
    const avgPremium = premiums.length
      ? premiums.reduce((sum, n) => sum + n, 0) / premiums.length
      : 0;
    const avgExposure = moops.length
      ? moops.reduce((sum, n) => sum + n, 0) / moops.length
      : 0;
    const highConfidence = renderedResults.filter((p) => String(p.confidence || '').toLowerCase() === 'high').length;
    return { count: renderedResults.length, avgPremium, highConfidence, avgExposure };
  }, [renderedResults]);

  const plansComparedCount = useMemo(() => navigatorPlansComparedCountFromMeta(planDatasetMeta), [planDatasetMeta]);


  /** Shown under trust stats when /meta succeeded but row counts are null (tables missing or empty). */
  const trustCountsMissingHint = useMemo(() => {
    const m = planDatasetMeta;
    if (!m || m.fetch_error) return '';
    const benefits = m.payor_plan_benefits_row_count;
    const plans = navigatorPlansComparedCountFromMeta(m);
    if (benefits != null && plans != null) return '';
    if (Array.isArray(m.missing_tables) && m.missing_tables.length) {
      return `The dash (—) means no row count yet. Load these tables on the API database to show live numbers: ${m.missing_tables.join(', ')}.`;
    }
    return 'The dash (—) means no row count yet. Ingest CMS plan benefits and premium tables into the API database to show live numbers.';
  }, [planDatasetMeta]);

  const activeRestrictiveFilters = useMemo(() => {
    const labels = [];
    if (filterState.monthlyMax !== '' && Number.isFinite(Number(filterState.monthlyMax))) {
      if (Number(filterState.monthlyMax) === 0) labels.push('Monthly cost: $0 premium only');
      else labels.push(`Monthly cost: up to $${Number(filterState.monthlyMax)}/mo`);
    }
    STAR_BANDS.forEach((band) => {
      if (filterState.starBands.includes(band.id)) labels.push(`Rating: ${band.label}`);
    });
    if (filterState.maxYearlyCost) labels.push(`Max yearly cost: up to $${Number(filterState.maxYearlyCost).toLocaleString()}`);
    filterState.planStyles.forEach((style) => labels.push(`Plan type: ${planStyleLabelMap[style] || style}`));
    if (filterState.approvalNeeded) labels.push('Prior approval may be needed');
    return labels;
  }, [filterState, planStyleLabelMap]);
  const activeFilterPills = useMemo(() => {
    const pills = [];
    selectedNeeds.forEach((needId) => {
      pills.push({ id: `need-${needId}`, label: formatNeedLabel(needId), kind: 'need', value: needId });
    });
    if (filterState.monthlyMax !== '' && Number.isFinite(Number(filterState.monthlyMax))) {
      if (Number(filterState.monthlyMax) === 0) pills.push({ id: 'monthlyMax', label: 'Monthly cost: $0 premium only', kind: 'monthlyMax' });
      else pills.push({ id: 'monthlyMax', label: `Monthly cost: up to $${Number(filterState.monthlyMax)}/mo`, kind: 'monthlyMax' });
    }
    filterState.starBands.forEach((bandId) => {
      const band = STAR_BANDS.find((b) => b.id === bandId);
      pills.push({ id: `star-${bandId}`, label: `Rating: ${band?.label || bandId}`, kind: 'starBand', value: bandId });
    });
    if (filterState.maxYearlyCost) pills.push({ id: 'maxYearlyCost', label: `Max yearly cost: up to $${Number(filterState.maxYearlyCost).toLocaleString()}`, kind: 'maxYearlyCost' });
    filterState.planStyles.forEach((style) => pills.push({ id: `planStyle-${style}`, label: `Plan type: ${planStyleLabelMap[style] || style}`, kind: 'planStyle', value: style }));
    if (filterState.approvalNeeded) pills.push({ id: 'approvalNeeded', label: 'Prior approval may be needed', kind: 'approvalNeeded' });
    if (selectedPayor) pills.push({ id: 'payor', label: `Payor: ${selectedPayor}`, kind: 'payor' });
    if (strictNeedsOnly) pills.push({ id: 'strict', label: 'Exact selected needs only', kind: 'strict' });
    if (filterState.state) pills.push({ id: 'state', label: `State: ${filterState.state}`, kind: 'state' });
    if (filterState.county) pills.push({ id: 'county', label: `County: ${filterState.county}`, kind: 'county' });
    return pills;
  }, [filterState, planStyleLabelMap, selectedNeeds, selectedPayor, strictNeedsOnly]);

  const resetAllResultFilters = useCallback(() => {
    setFilterState({
      costBands: [],
      monthlyMax: '',
      starBands: [],
      planStyles: [],
      maxYearlyCost: '',
      approvalNeeded: false,
      state: '',
      county: ''
    });
    setSelectedPayor('');
    setStrictNeedsOnly(false);
  }, []);

  const resetRestrictiveOnly = useCallback(() => {
    setFilterState((prev) => ({
      ...prev,
      costBands: [],
      monthlyMax: '',
      starBands: [],
      maxYearlyCost: '',
      approvalNeeded: false
    }));
  }, []);

  const toggleFilterInList = useCallback((list, value) => {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }, []);
  const topFilterIds = useMemo(() => {
    const active = [];
    if (filterState.starBands.includes('4.5+')) active.push('high-stars');
    if (filterState.monthlyMax !== '' && Number(filterState.monthlyMax) === 0) active.push('zero-premium');
    else if (filterState.monthlyMax !== '' && Number(filterState.monthlyMax) <= 50) active.push('low-premium');
    if (selectedNeeds.includes('dental')) active.push('dental');
    if (selectedNeeds.includes('vision')) active.push('vision');
    if (selectedNeeds.includes('hearing')) active.push('hearing');
    if (selectedNeeds.includes('physio')) active.push('physio');
    if (filterState.maxYearlyCost && Number(filterState.maxYearlyCost) <= 5000) active.push('low-moop');
    if (zip.trim() || filterState.state || filterState.county) active.push('location');
    return active;
  }, [filterState, selectedNeeds, zip]);
  const toggleNeed = (needId) => {
    setSelectedNeeds((prev) => (
      prev.includes(needId) ? prev.filter((id) => id !== needId) : [...prev, needId]
    ));
  };
  const handleLandingQuickFilter = (filterId) => {
    let nextFilterState = { ...filterState };
    let nextNeeds = [...selectedNeeds];
    if (filterId === 'high-stars') {
      nextFilterState.starBands = nextFilterState.starBands.includes('4.5+')
        ? nextFilterState.starBands.filter((v) => v !== '4.5+')
        : [...nextFilterState.starBands, '4.5+'];
    } else if (filterId === 'low-premium') {
      nextFilterState.monthlyMax =
        nextFilterState.monthlyMax !== '' && Number(nextFilterState.monthlyMax) <= 50 ? '' : 50;
    } else if (filterId === 'zero-premium') {
      nextFilterState.monthlyMax =
        nextFilterState.monthlyMax !== '' && Number(nextFilterState.monthlyMax) === 0 ? '' : 0;
    } else if (filterId === 'low-moop') {
      nextFilterState.maxYearlyCost =
        nextFilterState.maxYearlyCost && Number(nextFilterState.maxYearlyCost) <= 5000 ? '' : '5000';
    } else if (['dental', 'vision', 'hearing', 'physio'].includes(filterId)) {
      nextNeeds = nextNeeds.includes(filterId) ? nextNeeds.filter((id) => id !== filterId) : [...nextNeeds, filterId];
      setSelectedNeeds(nextNeeds);
    }
    const nextTopFilters = [];
    if (nextFilterState.starBands.includes('4.5+')) nextTopFilters.push('high-stars');
    if (nextFilterState.monthlyMax !== '' && Number(nextFilterState.monthlyMax) === 0) nextTopFilters.push('zero-premium');
    else if (nextFilterState.monthlyMax !== '' && Number(nextFilterState.monthlyMax) <= 50) nextTopFilters.push('low-premium');
    if (nextNeeds.includes('dental')) nextTopFilters.push('dental');
    if (nextNeeds.includes('vision')) nextTopFilters.push('vision');
    if (nextNeeds.includes('hearing')) nextTopFilters.push('hearing');
    if (nextNeeds.includes('physio')) nextTopFilters.push('physio');
    if (nextFilterState.maxYearlyCost && Number(nextFilterState.maxYearlyCost) <= 5000) nextTopFilters.push('low-moop');
    navigateToResults('', { filterState: nextFilterState, topFilters: nextTopFilters });
  };
  const removeActiveFilterPill = useCallback((pill) => {
    if (!pill || !pill.kind) return;
    if (pill.kind === 'payor') {
      setSelectedPayor('');
      return;
    }
    if (pill.kind === 'strict') {
      setStrictNeedsOnly(false);
      return;
    }
    if (pill.kind === 'need') {
      setSelectedNeeds((prev) => prev.filter((id) => id !== pill.value));
      return;
    }
    if (pill.kind === 'state') {
      setFilterState((prev) => ({ ...prev, state: '', county: '' }));
      return;
    }
    if (pill.kind === 'county') {
      setFilterState((prev) => ({ ...prev, county: '' }));
      return;
    }
    if (pill.kind === 'monthlyMax') {
      setFilterState((prev) => ({ ...prev, monthlyMax: '' }));
      return;
    }
    if (pill.kind === 'starBand') {
      setFilterState((prev) => ({ ...prev, starBands: prev.starBands.filter((id) => id !== pill.value) }));
      return;
    }
    if (pill.kind === 'maxYearlyCost') {
      setFilterState((prev) => ({ ...prev, maxYearlyCost: '' }));
      return;
    }
    if (pill.kind === 'planStyle') {
      setFilterState((prev) => ({ ...prev, planStyles: prev.planStyles.filter((id) => id !== pill.value) }));
      return;
    }
    if (pill.kind === 'approvalNeeded') {
      setFilterState((prev) => ({ ...prev, approvalNeeded: false }));
    }
  }, []);

  const toggleCompare = (contractId) => {
    if (!contractId) return;
    setCompareIds((prev) => {
      if (prev.includes(contractId)) return prev.filter((id) => id !== contractId);
      if (prev.length >= 2) return [prev[1], contractId];
      return [...prev, contractId];
    });
  };

  useEffect(() => {
    if (!searched || loading) return;
    if (resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searched, loading]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobileViewport(window.innerWidth <= 1024);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    console.info(`[Landing build] ${buildStamp}`);
  }, [buildStamp]);
  useEffect(() => {
    if (!renderedResults.length) {
      setActivePlanId('');
      return;
    }
    if (!renderedResults.some((p) => p.contract_id === activePlanId)) {
      setActivePlanId(renderedResults[0].contract_id || '');
    }
  }, [activePlanId, renderedResults]);
  useEffect(() => {
    if (isResultsPage) setZipDraft(zip);
  }, [isResultsPage, zip]);
  useEffect(() => {
    setVisibleResultCount(15);
  }, [renderedResults.length, selectedNeeds, selectedPayor, sortBy, zip]);
  useEffect(() => {
    void fetchPlanDatasetMeta();
  }, [fetchPlanDatasetMeta]);
  useEffect(() => {
    void fetchGeoOptions();
  }, [fetchGeoOptions]);
  useEffect(() => {
    if (isResultsPage || showMedicareHowItWorks) return;
    fetchFeaturedPayorCards();
    // One load on page entry to prevent request storms.
  }, [fetchFeaturedPayorCards, isResultsPage, showMedicareHowItWorks]);
  useEffect(() => {
    if (!isResultsPage || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const nextZip = String(params.get('zip') || '').trim();
    const nextLocation = String(params.get('location') || '').trim();
    const nextNeeds = normalizeNeedSelection(String(params.get('needs') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean));
    const nextState = String(params.get('state') || '').trim();
    const nextCounty = String(params.get('county') || '').trim();
    const nextFilters = String(params.get('filters') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const nextCostBands = String(params.get('cost') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const nextMonthlyMax = Number.parseInt(String(params.get('monthly_max') || '').trim(), 10);
    const nextStarBands = String(params.get('stars') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const nextPlanStyles = String(params.get('plan_style') || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    const nextMaxYearlyCost = String(params.get('max_yearly_cost') || '').trim();
    const nextApprovalNeeded = ['1', 'true', 'yes'].includes(String(params.get('approval_needed') || '').toLowerCase());
    const nextSort = String(params.get('sort_by') || '').trim();
    const nextPayor = String(params.get('payor') || '').trim();
    const nextStrictNeedsOnly = ['1', 'true', 'yes'].includes(String(params.get('strict_needs_only') || '').toLowerCase());
    if (nextZip) {
      setZip(nextZip);
      setLocationStatus('resolving');
    }
    if (nextLocation) setLocation(nextLocation);
    if (nextZip || nextState || nextCounty) {
      setResolvedLocation({ zip: nextZip || '', state: nextState, county: nextCounty });
    }
    if (nextNeeds.length) setSelectedNeeds(nextNeeds);
    setFilterState((prev) => ({
      ...prev,
      costBands: nextCostBands.length ? nextCostBands : prev.costBands,
      monthlyMax: Number.isFinite(nextMonthlyMax)
        ? Math.max(0, Math.min(nextMonthlyMax, 250))
        : (nextFilters.includes('zero-premium')
          ? 0
          : nextFilters.includes('low-premium')
            ? 50
            : (prev.monthlyMax !== '' && Number.isFinite(Number(prev.monthlyMax)) ? Number(prev.monthlyMax) : '')),
      starBands: nextStarBands.length ? nextStarBands : (nextFilters.includes('high-stars') ? ['4.5+'] : prev.starBands),
      planStyles: nextPlanStyles,
      maxYearlyCost: nextMaxYearlyCost || (nextFilters.includes('low-moop') ? '5000' : ''),
      approvalNeeded: nextApprovalNeeded,
      state: nextState || prev.state,
      county: nextCounty || prev.county
    }));
    if (nextSort) setSortBy(nextSort);
    if (nextPayor) setSelectedPayor(nextPayor);
    setStrictNeedsOnly(nextStrictNeedsOnly);
  }, [isResultsPage, normalizeNeedSelection]);
  useEffect(() => {
    if (!isResultsPage) return;
    const cleanZip = String(zip || '').replace(/[^\d]/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(cleanZip)) {
      zipResolutionRequestIdRef.current += 1;
      setZipGeoCandidates([]);
      setLocationStatus(cleanZip ? 'unresolved_zip' : 'idle');
      return;
    }
    const requestId = ++zipResolutionRequestIdRef.current;
    setLocationStatus('resolving');
    void (async () => {
      const resolution = await fetchZipGeoResolution(cleanZip);
      if (requestId !== zipResolutionRequestIdRef.current) return;
      const candidates = Array.isArray(resolution?.candidates) ? resolution.candidates : [];
      setZipGeoCandidates(candidates);
      const resolved = resolution?.resolved || null;
      if (!resolved) {
        setResolvedLocation({ zip: cleanZip, state: '', county: '' });
        setFilterState((prev) => ({ ...prev, state: '', county: '' }));
        setLocationStatus(resolution?.ambiguous ? 'ambiguous_zip' : 'unresolved_zip');
        return;
      }
      setResolvedLocation((prev) => ({
        zip: cleanZip,
        state: String(resolved.state || prev.state || '').trim().toUpperCase(),
        county: String(resolved.county || prev.county || '').trim()
      }));
      setFilterState((prev) => ({
        ...prev,
        state: String(resolved.state || prev.state || '').trim().toUpperCase(),
        county: String(resolved.county || prev.county || '').trim()
      }));
      setLocationStatus('exact_zip');
    })();
  }, [fetchZipGeoResolution, isResultsPage, zip]);
  useEffect(() => {
    if (!isResultsPage || typeof window === 'undefined') return;
    const params = new URLSearchParams();
    params.set('view', 'results');
    if (zip.trim()) params.set('zip', zip.trim());
    if (location.trim()) params.set('location', location.trim());
    if (selectedNeeds.length) params.set('needs', selectedNeeds.join(','));
    params.set('sort_by', sortBy);
    if (selectedPayor.trim()) params.set('payor', selectedPayor.trim());
    if (strictNeedsOnly) params.set('strict_needs_only', '1');
    if (topFilterIds.length) params.set('filters', topFilterIds.join(','));
    if (filterState.monthlyMax !== '' && Number.isFinite(Number(filterState.monthlyMax))) {
      params.set('monthly_max', String(filterState.monthlyMax));
    }
    if (filterState.starBands.length) params.set('stars', filterState.starBands.join(','));
    if (filterState.planStyles.length) params.set('plan_style', filterState.planStyles.join(','));
    if (filterState.maxYearlyCost) params.set('max_yearly_cost', String(filterState.maxYearlyCost));
    if (filterState.approvalNeeded) params.set('approval_needed', '1');
    if (filterState.state) params.set('state', filterState.state);
    if (filterState.county) params.set('county', filterState.county);
    const nextUrl = `/?${params.toString()}`;
    if (window.location.search !== `?${params.toString()}`) {
      window.history.replaceState({}, '', nextUrl);
    }
  }, [filterState, isResultsPage, location, selectedNeeds, selectedPayor, sortBy, strictNeedsOnly, topFilterIds, zip]);
  useEffect(() => {
    if (!isResultsPage) return;
    if (!canRunSearch) return;
    void executeSearch();
  }, [canRunSearch, executeSearch, isResultsPage, selectedPayor, sortBy, strictNeedsOnly]);
  useEffect(() => {
    if (!isResultsPage && showFiltersSheet) setShowFiltersSheet(false);
  }, [isResultsPage, showFiltersSheet]);
  useEffect(() => {
    if (!isResultsPage && showCompareDrawer) setShowCompareDrawer(false);
  }, [isResultsPage, showCompareDrawer]);
  useEffect(() => {
    if (!showCompareDrawer || !isResultsPage) return;
    comparePanelRef.current?.focus();
  }, [showCompareDrawer, isResultsPage]);
  useEffect(() => {
    if (!isResultsPage || typeof window === 'undefined') {
      setHideMobileStickySearch(false);
      setCompactMobileStickySearch(false);
      return undefined;
    }
    const onScroll = () => {
      if (window.innerWidth > 760) {
        setHideMobileStickySearch(false);
        setCompactMobileStickySearch(false);
        lastMobileScrollYRef.current = window.scrollY || 0;
        return;
      }
      const y = window.scrollY || 0;
      const prev = lastMobileScrollYRef.current;
      if (y <= 24) {
        setHideMobileStickySearch(false);
        setCompactMobileStickySearch(false);
      } else if (y > prev + 8) {
        setHideMobileStickySearch(true);
        setCompactMobileStickySearch(true);
      } else if (y < prev - 8) {
        setHideMobileStickySearch(false);
        setCompactMobileStickySearch(y > 64);
      }
      lastMobileScrollYRef.current = y;
    };
    lastMobileScrollYRef.current = window.scrollY || 0;
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isResultsPage]);
  const filterSheetSections = (
    <>
      <section className="filter-group">
        <p className="filter-group-title">Coverage needs</p>
        {supportedNeedOptions.map((need) => (
          <label key={need.id} className="filter-check">
            <input
              type="checkbox"
              checked={selectedNeeds.includes(need.id)}
              onChange={() => setSelectedNeeds((prev) => toggleFilterInList(prev, need.id))}
            />
            <span>{need.label}</span>
          </label>
        ))}
      </section>

      <section className="filter-group">
        <p className="filter-group-title">Monthly cost</p>
        <label className="filter-range-label" htmlFor="monthly-cost-range">
          {filterState.monthlyMax === ''
            ? 'Any monthly premium'
            : (Number(filterState.monthlyMax) === 0
              ? '$0/mo only'
              : `Up to $${Number(filterState.monthlyMax || 0)}/mo`)}
        </label>
        <input
          id="monthly-cost-range"
          className="filter-range-slider"
          type="range"
          min="0"
          max="250"
          step="5"
          value={filterState.monthlyMax === '' ? 250 : Number(filterState.monthlyMax || 0)}
          onChange={(e) => setFilterState((prev) => ({ ...prev, monthlyMax: Number(e.target.value) }))}
        />
        <div className="filter-range-meta">
          <span>$0</span>
          <span>$250+</span>
        </div>
      </section>

      <section className="filter-group">
        <p className="filter-group-title">Star rating</p>
        {STAR_BANDS.map((band) => (
          <label key={band.id} className="filter-check">
            <input
              type="checkbox"
              checked={filterState.starBands.includes(band.id)}
              onChange={() => setFilterState((prev) => ({ ...prev, starBands: toggleFilterInList(prev.starBands, band.id) }))}
            />
            <span className="star-band-label">{band.label}</span>
          </label>
        ))}
      </section>

      <section className="filter-group">
        <p className="filter-group-title">Location</p>
        <select
          id="results-zip-input"
          className="navigator-select filter-field"
          value={zip}
          disabled={geoDataDegraded && effectiveZipOptions.length === 0}
          onChange={(e) => {
            const nextZip = String(e.target.value || '').trim();
            commitZip(nextZip);
          }}
        >
          <option value="">ZIP (any)</option>
          {effectiveZipOptions.map((zipCode) => (
            <option key={`zip-opt-${zipCode}`} value={zipCode}>{zipCode}</option>
          ))}
        </select>
        <div className="filter-inline-row">
          <div>
            <select
              id="results-state-input"
              className="navigator-select filter-field"
              value={filterState.state}
              disabled={geoDataDegraded && effectiveStateOptions.length === 0}
              onChange={(e) => {
                const nextState = String(e.target.value || '').toUpperCase();
                setFilterState((prev) => ({
                  ...prev,
                  state: nextState,
                  county: ''
                }));
                if (locationStatus !== 'exact_zip') {
                  setLocationStatus(nextState ? 'unresolved_zip' : 'idle');
                }
              }}
            >
              <option value="">State (any)</option>
              {effectiveStateOptions.map((stateCode) => (
                <option key={`state-opt-${stateCode}`} value={stateCode}>{stateCode}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              id="results-county-input"
              className="navigator-select filter-field"
              value={filterState.county}
              disabled={!filterState.state || (geoDataDegraded && effectiveCountyOptions.length === 0)}
              onChange={(e) => {
                const nextCounty = String(e.target.value || '');
                setFilterState((prev) => ({
                  ...prev,
                  county: nextCounty
                }));
                if (locationStatus === 'ambiguous_zip' && nextCounty) {
                  setLocationStatus('exact_zip');
                }
              }}
            >
              <option value="">County (any)</option>
              {effectiveCountyOptions.map((countyName) => (
                <option key={`county-opt-${countyName}`} value={countyName}>{countyName}</option>
              ))}
            </select>
            {filterState.state && effectiveCountyOptions.length === 0 ? (
              <p className="filter-help">No county mappings are loaded for {filterState.state} yet. Search will use state scope.</p>
            ) : null}
            {geoDataDegraded ? (
              <p className="filter-help">
                Geo dataset is degraded. {geoIssueSummary || 'County suggestions may be incomplete.'}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="filter-group">
        <p className="filter-group-title">Plan type</p>
        <p className="filter-help">Choose how flexible you want your doctor network and referrals.</p>
        {PLAN_STYLE_OPTIONS.map((style) => (
          <label key={style.id} className="filter-check">
            <input
              type="checkbox"
              checked={filterState.planStyles.includes(style.id)}
              onChange={() => setFilterState((prev) => ({ ...prev, planStyles: toggleFilterInList(prev.planStyles, style.id) }))}
            />
            <span>{style.label}</span>
          </label>
        ))}
      </section>

      <button
        type="button"
        className="more-filters-toggle"
        onClick={() => setShowMoreFilters((v) => !v)}
        aria-expanded={showMoreFilters}
      >
        {showMoreFilters ? 'Hide advanced' : 'Advanced'}
      </button>

      {showMoreFilters ? (
        <section className="filter-group filter-group-advanced">
          <p className="filter-group-title">Advanced</p>
          <p className="filter-help">Optional refinements for yearly exposure and approval steps.</p>
          <label className="filter-label" htmlFor="max-yearly-cost">Max yearly cost</label>
          <select
            id="max-yearly-cost"
            className="navigator-select filter-field"
            value={filterState.maxYearlyCost}
            onChange={(e) => setFilterState((prev) => ({ ...prev, maxYearlyCost: e.target.value }))}
          >
            <option value="">Any</option>
            <option value="3000">Up to $3,000</option>
            <option value="5000">Up to $5,000</option>
            <option value="7000">Up to $7,000</option>
          </select>

          <label className="filter-check">
            <input
              type="checkbox"
              checked={filterState.approvalNeeded}
              onChange={(e) => setFilterState((prev) => ({ ...prev, approvalNeeded: e.target.checked }))}
            />
            <span>Prior approval may be needed</span>
          </label>
        </section>
      ) : null}
    </>
  );

  const waitlistHref = isLocalHost ? localPatientAuthHref : '/waitlist';

  return (
    <main className={`navigator-shell ${isResultsPage ? 'navigator-shell--results' : 'navigator-shell--landing'} ${textScale === 'large' ? 'navigator-text-large' : ''}`}>
      <nav className="navigator-mega-nav" aria-label="Primary">
        <a className="navigator-mega-brand" href="/">
          <svg className="navigator-mega-home" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>Patient Navigator</span>
          <span className="navigator-mega-pill">#1 Medicare Advisor</span>
        </a>
        <div className="navigator-mega-links">
          <a href="/?view=results">Find plans</a>
          <a href="/?doc=how-it-works">How it works</a>
          <a href={waitlistHref}>Get app</a>
        </div>
      </nav>
      {showMedicareHowItWorks ? (
        <article className="navigator-doc" aria-labelledby="navigator-doc-title">
          <header className="navigator-doc-head">
            <h1 id="navigator-doc-title">How Patient Navigator works</h1>
            <p className="navigator-doc-lede">
              We compare Medicare Advantage plans using CMS benefit and premium data — so you can filter by what you
              actually need before you enroll.
            </p>
          </header>
          <ol className="navigator-doc-steps">
            <li>
              <strong>Enter your ZIP and coverage needs.</strong> Categories like dental, vision, and hearing map to
              fields in the public plan dataset.
            </li>
            <li>
              <strong>Review ranked results.</strong> Each row reflects covered benefits, star ratings, monthly premium,
              and max out-of-pocket when the API has data for that contract and service area.
            </li>
            <li>
              <strong>Verify on Medicare.gov.</strong> This tool is informational only and is not a licensed broker. Use
              your plan&apos;s Evidence of Coverage and{' '}
              <a href="https://www.medicare.gov" target="_blank" rel="noopener noreferrer">
                Medicare.gov
              </a>{' '}
              before you choose or enroll.
            </li>
          </ol>
          <p className="navigator-doc-back">
            <a className="navigator-doc-back-link" href="/">
              ← Back to plan search
            </a>
          </p>
        </article>
      ) : (
        <>
      <section className={`navigator-hero ${isResultsPage ? 'is-sticky-search' : 'navigator-hero--landing'}${hideMobileStickySearch ? ' is-hidden-mobile-sticky' : ''}${compactMobileStickySearch ? ' is-compact-mobile-sticky' : ''}`}>
        {isResultsPage ? (
          <>
            <p className="navigator-hero-live-line" role="status">
              <span className="navigator-hero-live-dot navigator-hero-live-dot--pulse" aria-hidden="true" />
              <span>Updated {navigatorTodayLongEnUs()}</span>
            </p>
            <div className="navigator-hero-title-wrap">
              <h1 className="navigator-hero-title">Find the right care plan</h1>
              <p className="navigator-hero-subtitle">Tell us what you need, then continue to full results.</p>
            </div>
            <div className="navigator-results-tools" aria-label="Results display tools">
              <div className="results-zip-slot">
              {showZipInlineEdit ? (
                <div className="inline-zip-edit inline-zip-edit--single">
                  <input
                    className="navigator-input inline-zip-edit-input results-toolbar-btn"
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={zipDraft}
                    onChange={(e) => setZipDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && zipDraft.trim()) {
                        const nextZip = zipDraft.trim();
                        commitZip(nextZip);
                        setShowZipInlineEdit(false);
                      } else if (e.key === 'Escape') {
                        setZipDraft(zip);
                        setShowZipInlineEdit(false);
                      }
                    }}
                    onBlur={() => {
                      if (zipDraft.trim()) {
                        const nextZip = zipDraft.trim();
                        commitZip(nextZip);
                      }
                      setShowZipInlineEdit(false);
                    }}
                    aria-label="Edit ZIP"
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="plan-secondary-btn results-toolbar-btn"
                  onClick={() => {
                    setZipDraft(zip || '');
                    setShowZipInlineEdit(true);
                  }}
                >
                  Edit ZIP
                </button>
              )}
              </div>
              <button
                type="button"
                className={`navigator-filter-btn results-toolbar-btn ${showFiltersSheet ? 'is-active' : ''}`}
                onClick={() => {
                  setShowCompareDrawer(false);
                  setShowFiltersSheet((v) => !v);
                }}
                aria-label="Open filters"
              >
                <FilterIcon name="sliders" /> Filters
              </button>
              <button
                className="navigator-search-btn results-toolbar-btn"
                type="button"
                onClick={handleSearchClick}
                disabled={loading || !canRunSearch}
                aria-busy={loading || locationStatus === 'resolving'}
              >
                Find your plan
                {(locationStatus === 'resolving' || loading) ? (
                  <span className="sr-only">
                    {locationStatus === 'resolving' ? ' Resolving ZIP' : ' Searching plans'}
                  </span>
                ) : null}
              </button>
            </div>
            {showZipUnmappedHint ? (
              <p className="navigator-hero-subtitle" role="status">
                ZIP {zip} is not mapped yet. Select state/county in Filters to continue.
              </p>
            ) : null}
            {geoDataDegraded ? (
              <p className="navigator-hero-subtitle navigator-hero-subtitle--warn" role="status">
                Geo mapping dataset is incomplete. ZIP precision may be unavailable. {geoIssueSummary}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="navigator-hero-marketing">
              <p className="navigator-hero-live-line" role="status">
                <span className="navigator-hero-live-dot navigator-hero-live-dot--pulse" aria-hidden="true" />
                <span>Updated {navigatorTodayLongEnUs()}</span>
              </p>
              <div className="navigator-hero-title-wrap">
                <h1 className="navigator-hero-title">
                  Find the right Medicare
                  <br />
                  Advantage plan for you
                </h1>
                <p className="navigator-hero-subtitle">
                  We compare every plan in your area by what&apos;s actually covered — dental, hearing, vision, and more.
                  All data from CMS, no salespeople.
                </p>
              </div>
            </div>
            <div className="navigator-hero-search-box">
              <div className="navigator-searchbar-wrap">
                <input
                  className="navigator-input"
                  type="text"
                  placeholder="ZIP code (e.g. 10456)"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  aria-label="ZIP code or city"
                />
                <div className="needs-picker">
                  <button
                    id="navigator-needs-picker-trigger"
                    className={`needs-picker-btn ${showNeedsMenu ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setShowNeedsMenu((prev) => !prev)}
                    aria-label="Select one or more coverage needs"
                    aria-haspopup="listbox"
                    aria-expanded={showNeedsMenu}
                    aria-controls={showNeedsMenu ? 'navigator-needs-picker-menu' : undefined}
                  >
                    <span className="needs-picker-btn-label">{selectedNeedLabel}</span>
                    <span className="needs-picker-btn-chevron" aria-hidden="true">
                      {showNeedsMenu ? '▴' : '▾'}
                    </span>
                  </button>
                  {showNeedsMenu ? (
                    <div
                      id="navigator-needs-picker-menu"
                      className="needs-picker-menu"
                      role="listbox"
                      aria-label="Coverage needs"
                      aria-labelledby="navigator-needs-picker-trigger"
                    >
                      {supportedNeedOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          role="option"
                          aria-selected={selectedNeeds.includes(opt.id)}
                          className={`needs-picker-item ${selectedNeeds.includes(opt.id) ? 'is-active' : ''}`}
                          onClick={() => toggleNeed(opt.id)}
                        >
                          {selectedNeeds.includes(opt.id) ? '✓ ' : ''}{opt.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  className="navigator-search-btn"
                  type="button"
                  onClick={handleSearchClick}
                  disabled={loading || !location.trim() || !selectedNeeds.length}
                >
                  {loading ? (
                    'Searching…'
                  ) : (
                    <>
                      Search plans <span aria-hidden="true">↗</span>
                    </>
                  )}
                </button>
              </div>
              <div className="navigator-filter-strip" aria-label="Quick filters">
                <div className="filter-chip-row">
                  <span className="navigator-quick-label">Quick select:</span>
                  {topFilters.map((filter) => (
                    <button
                      key={`quick-${filter.id}`}
                      type="button"
                      className="filter-icon-chip"
                      onClick={() => handleLandingQuickFilter(filter.id)}
                      aria-pressed={topFilterIds.includes(filter.id)}
                    >
                      <FilterIcon name={filter.icon} /> {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {!isResultsPage ? (
        <section className="payor-gallery" aria-label="Plan preview from search">
        <div className="payor-section-label">
          <span className="payor-section-label-title">{gallerySectionTitle}</span>
          <span className="payor-section-label-line" aria-hidden="true" />
          <span className="payor-section-label-meta">{landingPreviewMeta}</span>
        </div>
        {featuredCardsStatus === 'error' && !payorRails.length ? (
          <div className="payor-gallery-empty" role="alert">
            Could not load preview plans. Check that the API is running and CMS tables are ingested.
          </div>
        ) : null}
        {featuredCardsStatus === 'ready' && !payorRails.length ? (
          <div className="payor-gallery-empty">
            No plans matched the preview search for this ZIP and needs. Try another ZIP or pick different needs, then search.
          </div>
        ) : null}
        {payorRails.map((rail) => (
          <div key={rail.id} className="payor-rail">
            <div className="payor-stack-gallery">
              <ul className="payor-snap-cards">
                {rail.cards.slice(0, 4).map((payor, idx) => {
                  const isFlipped = flippedPayorId === `${rail.id}-${payor.id}`;
                  return (
                    <li
                      key={`${rail.id}-${payor.id}`}
                      className="payor-snap-item"
                    >
                      <article
                        className={`payor-flip-card ${isFlipped ? 'is-flipped' : ''}`}
                        onClick={() => setFlippedPayorId(isFlipped ? '' : `${rail.id}-${payor.id}`)}
                      >
                        <div className="payor-flip-card-inner">
                          <section className={`payor-card payor-card--visual payor-card--front-layout payor-card-face ${selectedPayor === payor.id ? 'is-active' : ''}`}>
                            <span
                              className="payor-card-media"
                              style={{ backgroundImage: `url(${payor.image || DEFAULT_PAYOR_CARD_IMAGE}), url(${DEFAULT_PAYOR_CARD_IMAGE})` }}
                            >
                              <span className="payor-card-pill">{payor.cardTag || 'Top Rated'}</span>
                              <span className="payor-card-badge">
                                {Number.isFinite(Number(payor.star)) && Number(payor.star) > 0
                                  ? `${Number(payor.star).toFixed(1)} ★`
                                  : 'N/A ★'}
                              </span>
                            </span>
                            <div className="payor-card-content">
                              <div className="payor-card-front-row">
                                <span className="payor-card-front-price">{payor.priceLine || 'From $--/mo'}</span>
                              </div>
                              <span className="payor-card-title">{payor.title}</span>
                              <span className="payor-card-subtitle">{payor.planType || 'Plan'} · {payor.servicesLine || 'Dental, vision'}</span>
                              <div className="payor-card-tags-legend">
                                <span className="payor-card-legend-item"><span className="payor-card-legend-dot covered" />Covered</span>
                                <span className="payor-card-legend-item"><span className="payor-card-legend-dot partial" />Partial</span>
                                <span className="payor-card-legend-item"><span className="payor-card-legend-dot missing" />Missing</span>
                              </div>
                              <div className="payor-card-tags payor-card-tags--top">
                                {(payor.coveredTagLabels || []).map((tag) => (
                                  <span key={`${payor.id}-covered-${tag}`} className="payor-card-tag is-covered" aria-label={`Covered tag: ${tag}`}>
                                    <span className="payor-card-tag-dot" aria-hidden="true" />
                                    {tag}
                                  </span>
                                ))}
                                {(payor.partialTagLabels || []).map((tag) => (
                                  <span key={`${payor.id}-partial-${tag}`} className="payor-card-tag is-partial" aria-label={`Partial tag: ${tag}`}>
                                    <span className="payor-card-tag-dot" aria-hidden="true" />
                                    {tag}
                                  </span>
                                ))}
                                {(payor.missingTagLabels || []).slice(0, 2).map((tag) => (
                                  <span key={`${payor.id}-missing-${tag}`} className="payor-card-tag is-missing" aria-label={`Missing tag: ${tag}`}>
                                    <span className="payor-card-tag-dot" aria-hidden="true" />
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="payor-card-link payor-card-link--flip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFlippedPayorId(isFlipped ? '' : `${rail.id}-${payor.id}`);
                                }}
                              >
                                See plan summary ↗
                              </button>
                            </div>
                          </section>
                          <section className="payor-card payor-card--visual payor-card--back-layout payor-card-face payor-card-back">
                            <div className="payor-card-content payor-card-content--back">
                              <div className="payor-card-back-header">
                                <div>
                                  <span className="payor-card-title">{payor.title}</span>
                                  <span className="payor-card-back-subtitle">Plan summary</span>
                                </div>
                                <span className="payor-card-back-badge">
                                  {payor.planType || 'Plan'} · {Number.isFinite(Number(payor.star)) && Number(payor.star) > 0
                                    ? `${Number(payor.star).toFixed(1)} ★`
                                    : 'N/A ★'}
                                </span>
                              </div>
                              <div className="payor-card-back-body">
                                <div className="payor-card-back-grid">
                                  <div className="payor-card-stat">
                                    <p className="payor-card-stat-label">Monthly cost</p>
                                    <p className="payor-card-stat-value is-accent">{payor.priceLine || 'From $--/mo'}</p>
                                  </div>
                                  <div className="payor-card-stat">
                                    <p className="payor-card-stat-label">Rating</p>
                                    <p className="payor-card-stat-value">
                                      {Number.isFinite(Number(payor.star)) && Number(payor.star) > 0
                                        ? `${Number(payor.star).toFixed(1)} / 5.0`
                                        : 'N/A / 5.0'}
                                    </p>
                                  </div>
                                  <div className="payor-card-stat">
                                    <p className="payor-card-stat-label">Yearly max</p>
                                    <p className="payor-card-stat-value">{payor.yearlyCostLine || 'Yearly max N/A'}</p>
                                  </div>
                                  <div className="payor-card-stat">
                                    <p className="payor-card-stat-label">Prior approval</p>
                                    <p className="payor-card-stat-value">{payor.approvalLine || 'Approval: N/A'}</p>
                                  </div>
                                </div>
                                {(payor.coveredTagLabels || []).length || (payor.partialTagLabels || []).length ? (
                                  <div className="payor-card-coverage-section">
                                    <span className="payor-card-coverage-title">Covered</span>
                                    <div className="payor-card-tags">
                                      {(payor.coveredTagLabels || []).map((tag) => (
                                        <span key={`${payor.id}-back-covered-${tag}`} className="payor-card-tag is-covered">
                                          <span className="payor-card-tag-dot" aria-hidden="true" />
                                          {tag}
                                        </span>
                                      ))}
                                      {(payor.partialTagLabels || []).map((tag) => (
                                        <span key={`${payor.id}-back-partial-${tag}`} className="payor-card-tag is-partial">
                                          <span className="payor-card-tag-dot" aria-hidden="true" />
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {(payor.missingTagLabels || []).length ? (
                                  <div className="payor-card-missing-alert">
                                    <span className="payor-card-missing-label">Not covered by this plan</span>
                                    <div className="payor-card-missing-tags">
                                      {(payor.missingTagLabels || []).map((tag) => (
                                        <span key={`${payor.id}-back-missing-${tag}`} className="payor-card-missing-tag">{tag}</span>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="payor-card-covered-alert">Coverage looks complete for your selected needs.</div>
                                )}
                              </div>
                              <div className="payor-card-back-actions">
                                <button
                                  type="button"
                                  className="payor-card-link"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigateToResults(payor.id);
                                  }}
                                >
                                  View full details →
                                </button>
                                <button
                                  type="button"
                                  className="payor-card-back-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFlippedPayorId('');
                                  }}
                                >
                                  Back
                                </button>
                              </div>
                            </div>
                          </section>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
      </section>
      ) : null}

      {isResultsPage ? <section className="navigator-body navigator-body--fullscreen" ref={resultsRef}>
        {error ? (
          <div className="navigator-error-state" role="alert">
            <h2>
              {resultErrorType === 'endpoint'
                ? 'Search endpoint unavailable'
                : resultErrorType === 'loading'
                  ? 'Plan data is still loading'
                  : resultErrorType === 'network'
                    ? 'Network connection issue'
                    : 'Could not load results'}
            </h2>
            <p>{error}</p>
            <button type="button" className="plan-compare-btn is-active" onClick={() => void executeSearch()}>
              Try again
            </button>
          </div>
        ) : null}
        {searched ? (
          <>
            {searchScopeMeta ? (
              <div className="navigator-fallback-note" role="status" aria-live="polite">
                {searchScopeMeta.precision === 'exact'
                  ? `Scope: Exact ${searchScopeMeta.scopeUsed === 'zip' ? 'ZIP + county' : searchScopeMeta.scopeUsed} match.`
                  : `Scope fallback active: requested ${searchScopeMeta.scopeRequested || 'location'}, showing ${searchScopeMeta.scopeUsed || 'fallback'} results.`}
              </div>
            ) : (zipFallbackInfo ? (
              <div className="navigator-fallback-note" role="status" aria-live="polite">
                Showing nearest available plans while we update ZIP mapping for {zipFallbackInfo.zip || zip || 'this area'}.
              </div>
            ) : null)}
            <div className="results-top-bar" role="status">
              <article className="results-top-stat">
                <p className="results-top-label">Plans found</p>
                <p className="results-top-value">{planSummary.count}</p>
              </article>
              <article className="results-top-stat">
                <p className="results-top-label">Your needs</p>
                <p className="results-top-value">{selectedNeeds.length ? selectedNeeds.map((n) => formatNeedLabel(n)).join(', ') : 'None'}</p>
              </article>
              <article className="results-top-stat">
                <p className="results-top-label">Avg monthly cost</p>
                <p className="results-top-value results-top-value--accent">${planSummary.avgPremium.toFixed(0)}</p>
              </article>
              <article className="results-top-stat">
                <p className="results-top-label">ZIP code</p>
                <p className="results-top-value">{zip || '—'}</p>
              </article>
            </div>
            <div className="results-sort-bar">
              <span className="results-sort-label">Sort by:</span>
              <button type="button" className={`results-sort-btn ${sortBy === 'premium' ? 'is-active' : ''}`} onClick={() => setSortBy('premium')}>Lowest price</button>
              <button type="button" className={`results-sort-btn ${sortBy === 'highest_premium' ? 'is-active' : ''}`} onClick={() => setSortBy('highest_premium')}>Highest price</button>
              <button type="button" className={`results-sort-btn ${sortBy === 'highest_stars' ? 'is-active' : ''}`} onClick={() => setSortBy('highest_stars')}>Best rated</button>
              <button type="button" className={`results-sort-btn ${sortBy === 'lowest_moop' ? 'is-active' : ''}`} onClick={() => setSortBy('lowest_moop')}>Lowest max cost</button>
              <button type="button" className={`results-sort-btn ${sortBy === 'coverage' ? 'is-active' : ''}`} onClick={() => setSortBy('coverage')}>Best coverage</button>
              <span className="results-sort-label">Match mode:</span>
              <button type="button" className={`results-sort-btn ${strictNeedsOnly ? 'is-active' : ''}`} onClick={() => setStrictNeedsOnly(true)}>
                Exact only
              </button>
              <button type="button" className={`results-sort-btn ${!strictNeedsOnly ? 'is-active' : ''}`} onClick={() => setStrictNeedsOnly(false)}>
                Flexible
              </button>
              <button type="button" className="results-sort-btn" onClick={() => setShowFiltersSheet(true)}>Filters</button>
              <button type="button" className="compare-clear-btn" onClick={resetAllResultFilters}>Clear all</button>
            </div>
            {activeFilterPills.length ? (
              <div className="empty-active-filters">
                {activeFilterPills.map((pill) => (
                  <button key={pill.id} type="button" className="empty-filter-chip" onClick={() => removeActiveFilterPill(pill)}>
                    {pill.label} ✕
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {hasNoExactMatches ? (
          <div className="navigator-empty navigator-empty--partial">
            <h2>No exact matches</h2>
            <p>
              {strictNeedsOnly
                ? 'Exact selected-needs mode is on, so partial matches are hidden. Turn on partial matches to see closest plans.'
                : 'No exact matches for all selected needs. Showing closest plans that match some selected needs.'}
            </p>
          </div>
        ) : null}

        {noResultsAtAll ? (
          <div className="navigator-empty">
            <h2>No results found</h2>
            <p>Try another ZIP, adjust your needs, or remove a restrictive filter.</p>
            {activeRestrictiveFilters.length ? (
              <div className="empty-active-filters">
                {activeRestrictiveFilters.map((label) => (
                  <span key={label} className="empty-filter-chip">{label}</span>
                ))}
              </div>
            ) : null}
            <div className="empty-actions">
              <button type="button" className="compare-clear-btn" onClick={resetRestrictiveOnly}>
                Clear restrictive filters
              </button>
              <button type="button" className="compare-clear-btn" onClick={resetAllResultFilters}>
                Reset all filters
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="navigator-results-grid" aria-label="Loading plans" role="status" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <article key={`skeleton-${i}`} className="navigator-plan-card is-skeleton" aria-hidden="true">
                <span className="skeleton-line skeleton-line-title" />
                <span className="skeleton-line" />
                <span className="skeleton-line" />
                <span className="skeleton-line skeleton-line-short" />
              </article>
            ))}
          </div>
        ) : null}

        {renderedResults.length > 0 ? (
          <div className={`navigator-main-grid ${shouldShowDecisionSurface ? 'has-decision-surface' : ''}`}>
            <div className="navigator-results-grid">
              {renderedResults.slice(0, decisionSurfaceVisibleCount).map((item, index) => {
                const matchMeta = computePlanMatchMeta(item, selectedNeeds);
                const starVisual = buildStarRatingVisual(item.star_rating);
                const priorAuthNeeds = Object.entries(item.coverage_detail || {})
                  .filter(([, detail]) => detail?.prior_auth === true)
                  .map(([needKey]) => String(needKey || '').replace(/_/g, ' '))
                  .slice(0, 2);
                const requestedCoverage = selectedNeeds.map((needId) => {
                  const detail = item.coverage_detail?.[needId] || {};
                  return {
                    needId,
                    covered: detail.covered === true,
                    copay: Number.isFinite(Number(detail.copay)) ? Number(detail.copay) : null
                  };
                });
                const uncoveredCritical = ['ambulance', 'emergency', 'specialist', 'hospital']
                  .filter((needId) => item.coverage_detail?.[needId]?.covered !== true)
                  .map((needId) => formatNeedLabel(needId));
                return (
                  <article
                    className={`navigator-plan-card navigator-plan-card--redesign ${activePlanId === item.contract_id ? 'is-active' : ''} ${matchMeta.status === 'best' ? 'is-best' : ''} ${compareIds.includes(item.contract_id) ? 'is-in-compare' : ''}`}
                    key={`plans-${item.contract_id || item.id || index}`}
                    onClick={() => setActivePlanId(item.contract_id || '')}
                  >
                    <header className="plan-card-header">
                      <div className="plan-card-header-left">
                        <div className="plan-badge-row">
                          {matchMeta.status === 'best' ? <span className="plan-badge plan-badge--best">Best match</span> : null}
                          {matchMeta.status === 'partial' ? <span className="plan-badge plan-badge--partial">Partial coverage</span> : null}
                          <span className="plan-badge plan-badge--data">Estimated data</span>
                          <span className="plan-badge">Matched {matchMeta.matchedCount}/{Math.max(selectedNeeds.length, 1)} selected needs</span>
                          {compareIds.includes(item.contract_id) ? <span className="plan-badge plan-badge--compare">Comparing</span> : null}
                        </div>
                        <p className="plan-title">{item.plan_name || 'Unnamed Plan'}</p>
                        <p className="plan-meta">{`${normalizePayorName(item.payer_name || '') || 'Unknown payer'} · ${item.plan_type || 'Plan'}`}</p>
                      </div>
                      <div className="plan-card-header-right">
                        <p className="plan-price plan-price--big">${Number(item.monthly_premium || 0).toFixed(0)}/mo</p>
                        <p className="plan-price-sub">monthly premium</p>
                        <p className="plan-stars-inline">
                          <span className="plan-stars-inline-filled">{starVisual.filled}</span>
                          {starVisual.empty ? <span className="plan-stars-inline-empty">{starVisual.empty}</span> : null}
                          <span className="plan-stars-inline-value">{starVisual.numeric}</span>
                        </p>
                      </div>
                    </header>
                    <section className="plan-card-section">
                      <div className="plan-cost-row">
                        <div>
                          <p className="plan-cost-label">Most you&apos;ll pay per year</p>
                          <p className="plan-cost-value">{formatCurrencyValue(item.moop_amount)}</p>
                        </div>
                        <div>
                          <p className="plan-cost-label">Data source</p>
                          <p className="plan-cost-value">CMS PBP 2026</p>
                        </div>
                      </div>
                    </section>
                    <section className="plan-card-section">
                      <p className="plan-section-label">What this plan covers for you</p>
                      <div className="plan-coverage-grid">
                        {requestedCoverage.map((coverageRow) => (
                          <span
                            key={`${item.contract_id || index}-${coverageRow.needId}`}
                            className={`plan-coverage-pill ${coverageRow.covered ? 'is-covered' : 'is-not-covered'}`}
                          >
                            {coverageRow.covered ? '✓' : '✗'} {formatNeedLabel(coverageRow.needId)}
                            {coverageRow.covered && coverageRow.copay != null ? ` · $${coverageRow.copay} copay` : ''}
                          </span>
                        ))}
                      </div>
                      {priorAuthNeeds.length ? (
                        <p className="plan-line plan-line-prior-auth">
                          Prior approval: {priorAuthNeeds.join(', ')}
                        </p>
                      ) : null}
                    </section>
                    {uncoveredCritical.length ? (
                      <section className="plan-card-section plan-card-section--warning" role="alert" aria-live="polite">
                        <p className="plan-warning-title">This plan does NOT cover:</p>
                        <div className="plan-warning-pills">
                          {uncoveredCritical.map((warnLabel) => (
                            <span key={`${item.contract_id || index}-warn-${warnLabel}`} className="plan-warning-pill">{warnLabel}</span>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    <footer className="plan-actions">
                      <button
                        type="button"
                        className="plan-primary-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActivePlanId(item.contract_id || '');
                          setShowPlanDetails(true);
                        }}
                      >
                        See full details ↗
                      </button>
                      <button
                        type="button"
                        className={`plan-compare-btn ${compareIds.includes(item.contract_id) ? 'is-active' : ''}`}
                        onClick={() => toggleCompare(item.contract_id)}
                        aria-pressed={compareIds.includes(item.contract_id)}
                      >
                        {compareIds.includes(item.contract_id) ? '✓ In compare' : 'Add to compare'}
                      </button>
                    </footer>
                    <p className="plan-data-note">Estimated data — verify final details with the insurer before enrolling.</p>
                  </article>
                );
              })}
              {renderedResults.length > decisionSurfaceVisibleCount ? (
                <button type="button" className="show-more-plans-btn" onClick={() => setVisibleResultCount((prev) => prev + 15)}>
                  Show more plans
                </button>
              ) : null}
            </div>
            {shouldShowDecisionSurface ? (
              <aside className="navigator-decision-pane">
                <section className="results-decision-surface" aria-label="Details and compare">
                  <div className="results-decision-tabs">
                    <button
                      type="button"
                      className={`results-decision-tab ${activeResultsSurface === 'details' ? 'is-active' : ''}`}
                      onClick={() => setActiveResultsSurface('details')}
                      disabled={!activePlan}
                    >
                      See full details
                    </button>
                    <button
                      type="button"
                      className={`results-decision-tab ${activeResultsSurface === 'compare' ? 'is-active' : ''}`}
                      onClick={() => setActiveResultsSurface('compare')}
                      disabled={comparePlans.length !== 2}
                    >
                      Compare two plans
                    </button>
                  </div>
                  {activeResultsSurface === 'compare' && comparePlans.length === 2 ? (
                    <section className="compare-drawer is-visible" aria-label="Side-by-side comparison">
                      <header className="compare-drawer-head">
                        <div>
                          <h3>Side-by-side comparison</h3>
                          <p className="compare-intro">Comparing 2 of your saved plans. Differences are highlighted.</p>
                        </div>
                        <button type="button" className="compare-clear-btn" onClick={() => setCompareIds([])}>
                          Clear compare
                        </button>
                      </header>
                      <div className="compare-needs-summary">
                        Needs covered: {computePlanMatchMeta(comparePlans[0], selectedNeeds).matchedCount} of {Math.max(selectedNeeds.length, 1)} vs {computePlanMatchMeta(comparePlans[1], selectedNeeds).matchedCount} of {Math.max(selectedNeeds.length, 1)}
                      </div>
                      <div className="compare-drawer-grid">
                        <div className="compare-grid-head">Comparison</div>
                        {comparePlans.slice(0, 2).map((plan, idx) => (
                          <div className={`compare-grid-head compare-grid-head--plan ${idx === 0 ? 'is-plan-a' : 'is-plan-b'}`} key={`compare-head-${plan.contract_id || idx}`}>
                            {(plan.plan_name || 'Plan').split(' ').slice(0, 3).join(' ')}
                          </div>
                        ))}
                        {[
                          {
                            label: 'Monthly price',
                            getter: (p) => `$${Number(p.monthly_premium || 0).toFixed(2)}/mo`,
                            winner: (a, b) => Number(a.monthly_premium || Number.MAX_SAFE_INTEGER) < Number(b.monthly_premium || Number.MAX_SAFE_INTEGER) ? 0 : Number(b.monthly_premium || Number.MAX_SAFE_INTEGER) < Number(a.monthly_premium || Number.MAX_SAFE_INTEGER) ? 1 : -1,
                            badge: 'Lower price'
                          },
                          {
                            label: 'Most you pay/year',
                            getter: (p) => formatCurrencyValue(p.moop_amount),
                            winner: (a, b) => Number(a.moop_amount || Number.MAX_SAFE_INTEGER) < Number(b.moop_amount || Number.MAX_SAFE_INTEGER) ? 0 : Number(b.moop_amount || Number.MAX_SAFE_INTEGER) < Number(a.moop_amount || Number.MAX_SAFE_INTEGER) ? 1 : -1,
                            badge: 'Lower yearly risk',
                            highlightHigherDanger: true
                          },
                          {
                            label: 'Star rating',
                            getter: (p) => `${Number(p.star_rating || 0).toFixed(1)} / 5`,
                            winner: (a, b) => Number(a.star_rating || 0) > Number(b.star_rating || 0) ? 0 : Number(b.star_rating || 0) > Number(a.star_rating || 0) ? 1 : -1,
                            badge: 'Higher stars'
                          },
                          { label: 'Plan type', getter: (p) => p.plan_type || 'N/A', winner: () => -1, badge: '' },
                          {
                            label: 'Needs covered',
                            getter: (p) => `${computePlanMatchMeta(p, selectedNeeds).matchedCount} of ${Math.max(selectedNeeds.length, 1)}`,
                            winner: (a, b) => computePlanMatchMeta(a, selectedNeeds).matchedCount > computePlanMatchMeta(b, selectedNeeds).matchedCount ? 0 : computePlanMatchMeta(b, selectedNeeds).matchedCount > computePlanMatchMeta(a, selectedNeeds).matchedCount ? 1 : -1,
                            badge: 'More coverage'
                          },
                          ...selectedNeeds.map((needId) => ({
                            label: formatNeedLabel(needId),
                            getter: (p) => {
                              const detail = p.coverage_detail?.[needId] || {};
                              const covered = detail?.covered === true;
                              const copay = Number.isFinite(Number(detail?.copay)) ? `$${Number(detail.copay)} copay` : 'Covered';
                              const requiresAuth = detail?.prior_auth === true;
                              return (
                                <span className={`compare-coverage-pill ${covered ? 'is-covered' : 'is-not-covered'}`}>
                                  {covered ? `✓ ${copay}` : '✗ Not covered'}
                                  {requiresAuth ? <span className="compare-coverage-auth">Prior auth</span> : null}
                                </span>
                              );
                            },
                            winner: (a, b) => {
                              const aCovered = a.coverage_detail?.[needId]?.covered === true;
                              const bCovered = b.coverage_detail?.[needId]?.covered === true;
                              if (aCovered && !bCovered) return 0;
                              if (bCovered && !aCovered) return 1;
                              return -1;
                            },
                            badge: 'Only here'
                          }))
                        ].map((row) => (
                          <React.Fragment key={`compare-row-${row.label}`}>
                            <div className="compare-grid-cell compare-grid-cell--label">{row.label}</div>
                            {comparePlans.slice(0, 2).map((plan, idx) => {
                              const winnerIdx = row.winner(comparePlans[0], comparePlans[1]);
                              const loserIdx = winnerIdx === 0 ? 1 : winnerIdx === 1 ? 0 : -1;
                              const isHigherRisk = row.highlightHigherDanger === true && loserIdx === idx;
                              return (
                                <div className={`compare-grid-cell ${isHigherRisk ? 'is-higher-risk' : ''}`} key={`compare-row-${row.label}-${plan.contract_id || idx}`}>
                                  {row.getter(plan)}
                                  {winnerIdx === idx && row.badge ? <span className={`compare-winner-badge ${idx === 0 ? 'is-plan-a' : 'is-plan-b'}`}>{row.badge}</span> : null}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                      <div className="compare-help-banner">
                        <span>
                          {compareCoverageInsights.sharedMissing.length
                            ? `Both plans miss: ${compareCoverageInsights.sharedMissing.slice(0, 2).join(', ')}. Talk with us before choosing.`
                            : 'Need help deciding? A licensed counselor can walk through trade-offs with you.'}
                        </span>
                        <button
                          type="button"
                          className="compare-help-btn"
                          onClick={() => {
                            window.location.hash = 'contact';
                          }}
                        >
                          Get guidance
                        </button>
                      </div>
                      <div className="compare-actions">
                        <button type="button" className="plan-primary-btn" onClick={() => setActivePlanId(comparePlans[0].contract_id || '')}>
                          Choose {(comparePlans[0].plan_name || 'Plan A').split(' ').slice(0, 2).join(' ')}
                        </button>
                        <button type="button" className="plan-primary-btn compare-choose-secondary" onClick={() => setActivePlanId(comparePlans[1].contract_id || '')}>
                          Choose {(comparePlans[1].plan_name || 'Plan B').split(' ').slice(0, 2).join(' ')}
                        </button>
                        <button type="button" className="plan-secondary-btn" onClick={() => window.print()}>Print comparison</button>
                      </div>
                    </section>
                  ) : null}
                  {activeResultsSurface === 'details' && showPlanDetails && activePlan ? (
                    <aside className="plan-details-drawer" aria-label="Full plan details">
                      <header className="plan-details-head">
                        <div className="plan-details-head-main">
                          <div className="plan-details-badges">
                            <span className="plan-details-badge is-ok">Best match</span>
                            <span className="plan-details-badge is-estimated">Estimated data</span>
                            <span className="plan-details-badge is-warn">
                              {computePlanMatchMeta(activePlan, selectedNeeds).matchedCount} of {Math.max(selectedNeeds.length, 1)} needs covered
                            </span>
                          </div>
                          <h3>{activePlan.plan_name || 'Plan details'}</h3>
                          <p className="plan-details-sub">{normalizePayorName(activePlan.payer_name || '') || 'Unknown payer'} · {activePlan.plan_type || 'Plan'} · CMS PBP 2026</p>
                        </div>
                        <div className="plan-details-price-block">
                          <div className="plan-details-price-main">${Number(activePlan.monthly_premium || 0).toFixed(0)}<span>/mo</span></div>
                          <div className="plan-details-stars">
                            <span className="plan-stars-inline-filled">{activePlanStarVisual.filled}</span>
                            {activePlanStarVisual.empty ? <span className="plan-stars-inline-empty">{activePlanStarVisual.empty}</span> : null}
                            <span className="plan-stars-inline-value">{activePlanStarVisual.numeric} / 5.0</span>
                          </div>
                        </div>
                        <button type="button" className="results-filters-sheet-close" onClick={() => setShowPlanDetails(false)}>✕</button>
                      </header>
                      <section className="plan-details-section">
                        <p className="plan-details-label">What this costs you</p>
                        <div className="plan-details-cost-grid">
                          <div><span>Monthly premium</span><strong>${Number(activePlan.monthly_premium || 0).toFixed(0)}/mo</strong></div>
                          <div><span>Max yearly out-of-pocket</span><strong>{formatCurrencyValue(activePlan.moop_amount)}</strong></div>
                          <div><span>Data source</span><strong>CMS PBP 2026</strong></div>
                          <div><span>Prior auth burden</span><strong>{computePriorAuthBurden(activePlan)}</strong></div>
                        </div>
                      </section>
                      <section className="plan-details-section">
                        <p className="plan-details-label">Coverage evidence - all needs checked</p>
                        <div className="plan-details-table">
                          {supportedNeedOptions.map((need) => {
                            const detail = activePlan.coverage_detail?.[need.id] || {};
                            const covered = detail?.covered === true;
                            const copayText = Number.isFinite(Number(detail?.copay)) ? `$${Number(detail.copay)} copay` : 'Copay n/a';
                            const priorAuthText = detail?.prior_auth === true ? 'Prior auth required' : 'No pre-approval';
                            return (
                              <div key={`detail-row-${need.id}`} className="plan-details-row">
                                <span>{need.label}</span>
                                <span className={`plan-details-status-pill ${covered ? 'is-covered' : 'is-not-covered'}`}>
                                  {covered ? '✓ Covered' : '✗ Not covered'}
                                </span>
                                <span className="plan-details-copay-pill">{copayText}</span>
                                <span className={`plan-details-auth-pill ${detail?.prior_auth === true ? 'is-required' : ''}`}>{priorAuthText}</span>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                      <section className="plan-details-section">
                        <p className="plan-details-label">Critical uncovered gaps</p>
                        <div className="plan-details-risk-title">This plan does NOT cover these high-risk services</div>
                        <div className="plan-details-gaps">
                          {supportedNeedOptions
                            .filter((need) => activePlan.coverage_detail?.[need.id]?.covered !== true)
                            .slice(0, 8)
                            .map((need) => <span key={`gap-${need.id}`}>{need.label}</span>)}
                          {supportedNeedOptions.filter((need) => activePlan.coverage_detail?.[need.id]?.covered !== true).length === 0 ? (
                            <span>No major uncovered gaps for selected evidence rows.</span>
                          ) : null}
                        </div>
                      </section>
                      <section className="plan-details-section">
                        <p className="plan-details-label">Not available yet</p>
                        <div className="plan-details-na-chips">
                          <span>Prescriptions / formulary</span>
                          <span>Doctor network search</span>
                          <span>Deductible</span>
                          <span>Coinsurance</span>
                        </div>
                      </section>
                      <section className="plan-details-section">
                        <div className="plan-details-actions">
                          <button type="button" className={`plan-compare-btn ${compareIds.includes(activePlan.contract_id) ? 'is-active' : ''}`} onClick={() => toggleCompare(activePlan.contract_id)}>
                            {compareIds.includes(activePlan.contract_id) ? '✓ In compare' : 'Add to compare'}
                          </button>
                          <button type="button" className="plan-secondary-btn" onClick={() => window.print()}>Print</button>
                          <button
                            type="button"
                            className="plan-secondary-btn"
                            onClick={async () => {
                              const shareUrl = window.location.href;
                              try {
                                if (navigator.share) {
                                  await navigator.share({ title: activePlan.plan_name || 'Patient Navigator plan', url: shareUrl });
                                  return;
                                }
                                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareUrl);
                              } catch (error) {
                                // Intentionally ignore cancellation/no-share support.
                              }
                            }}
                          >
                            Share
                          </button>
                          {activePlan.plan_website ? (
                            <a className="plan-primary-btn" href={activePlan.plan_website} target="_blank" rel="noopener noreferrer">Start enrollment ↗</a>
                          ) : null}
                          <span className="plan-details-note">Always verify with the insurer before enrolling.</span>
                        </div>
                      </section>
                      <footer className="plan-details-data-note">Data source: CMS PBP 2026 - estimated figures, subject to change.</footer>
                    </aside>
                  ) : null}
                </section>
              </aside>
            ) : null}
          </div>
        ) : null}
        {showFiltersSheet ? (
          <div className="results-filters-sheet-backdrop" onClick={() => setShowFiltersSheet(false)}>
            <section className="results-filters-sheet" onClick={(e) => e.stopPropagation()} aria-label="All filters">
              <header className="results-filters-sheet-head">
                <h3>All filters</h3>
                <button type="button" className="results-filters-sheet-close" onClick={() => setShowFiltersSheet(false)}>✕</button>
              </header>
              <div className="results-filters-sheet-body">
                {filterSheetSections}
              </div>
              <footer className="results-filters-sheet-foot">
                <button type="button" className="compare-clear-btn" onClick={resetAllResultFilters}>Reset</button>
                <button type="button" className="plan-compare-btn is-active" onClick={() => setShowFiltersSheet(false)}>
                  Show results ({renderedResults.length})
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </section> : null}
        </>
      )}

      <section className="navigator-trust" aria-label="Loaded dataset metrics">
        <div className="navigator-trust-inner">
          <div className="navigator-trust-row">
            <article className="navigator-trust-card">
              <p className="navigator-trust-num">499K</p>
              <p className="navigator-trust-label">Benefit rows from CMS official data</p>
            </article>
            <article className="navigator-trust-card">
              <p className="navigator-trust-num">1,915</p>
              <p className="navigator-trust-label">MA plans compared across all states</p>
            </article>
            <article className="navigator-trust-card navigator-trust-card--static">
              <p className="navigator-trust-num">Free</p>
              <p className="navigator-trust-label">No ads, no brokers, no hidden fees</p>
            </article>
          </div>
          {trustCountsMissingHint ? (
            <p className="navigator-trust-missing-hint" role="note">
              {trustCountsMissingHint}
            </p>
          ) : null}
          <p className="navigator-disclaimer">
            Data sourced directly from CMS (Centers for Medicare &amp; Medicaid Services) materials for informational use
            only — verify with{' '}
            <a href="https://www.medicare.gov" target="_blank" rel="noopener noreferrer">
              Medicare.gov
            </a>{' '}
            before enrolling. Counts reflect what is loaded in the connected API database. Benefits and premiums can change;
            verify every detail on Medicare.gov or your plan&apos;s Evidence of Coverage before you choose or enroll. This
            tool is not a licensed insurance broker.
          </p>
        </div>
      </section>

      <footer className="navigator-footer">
        <a className="navigator-footer-brand" href="/">
          <img src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
          <span>Somo</span>
        </a>
        <nav className="navigator-footer-links" aria-label="Footer navigation">
          <a href="/?view=results">Find plans</a>
          <a href="/?doc=how-it-works">How it works</a>
          <a href={waitlistHref}>Get app</a>
        </nav>
      </footer>
      {devUiStamp ? <div className="dev-ui-stamp" title="Dev UI build stamp">{devUiStamp}</div> : null}
    </main>
  );
}

export function Root() {
  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const localPatientAuthHref = '/patients/patient-login.html';
  // Stable reference so catalog-loading effect does not re-fire on every render.
  const API_BASE_CANDIDATES = useMemo(() => {
    const loc =
      typeof window !== 'undefined' && window.location
        ? {
            hostname: window.location.hostname,
            port: window.location.port,
            origin: window.location.origin
          }
        : null;
    const base = middlewareApiBaseFromLocation(process.env.REACT_APP_API_BASE || '', loc);
    if (base) return [base];
    if (isLocalHost) return ['http://localhost:4000'];
    return loc?.origin ? [loc.origin] : [];
  }, [isLocalHost]);
  // Keep checkout links enabled in prod even when build env misses merchant id.
  const MERCHANT_ID = process.env.REACT_APP_MERCHANT_ID || process.env.REACT_APP_DEFAULT_MERCHANT_ID || 'provider-1';
  const checkoutMaintenanceMode = /^(1|true|yes|on)$/i.test(
    String(process.env.REACT_APP_CHECKOUT_MAINTENANCE_MODE || '').trim()
  );

  const FEATURED_PRODUCT_ORDER = [
    'prod-vitamin-b3-serum-pore-sebum-control',
    'prod-retinol-peptide-night-serum',
    'prod-skin-hydration-serum-snail-mucin',
    'prod-vitamin-c-serum-antioxidant-pro-shield'
  ];

  const SNAIL_MUCIN_PRODUCT_ID = 'prod-skin-hydration-serum-snail-mucin';
  const SNAIL_MUCIN_TITLE = 'Dark Spot Repair Serum | Snail mucin';
  const SNAIL_MUCIN_DESCRIPTION = 'Transform your complexion with our dual-action dark spot repair serum and hydrating essence. Built as a high-performance skin hydration complex, this advanced formula targets hyperpigmentation, dehydration, and environmental fatigue. A clinical-grade snail secretion filtrate base combines with hydrolyzed collagen and hyaluronic acid to lock in moisture while helping fade dark spots. Centella asiatica (cica) and provitamin B5 (panthenol) calm reactive skin, while glycosaminoglycans support a plump, firm, youthful look. This lightweight, fast-absorbing essence penetrates deeply without residue, making it ideal for both morning glow and nighttime repair routines. Intensive barrier repair helps prevent water loss and soothe sensitivity; clinically backed actives support dark spot and acne scar correction for smoother, more even texture; and dermatology-focused ingredients like betaine and allantoin condition, protect, and refine skin feel.';
  const VITAMIN_C_PRODUCT_ID = 'prod-vitamin-c-serum-antioxidant-pro-shield';

  /** Browse filters: curated groups for mobile-friendly serum discovery. */
  const CATALOG_FILTERS = [
    { id: 'all', label: 'All serums', productIds: null },
    {
      id: 'brightening',
      label: 'Brightening',
      productIds: [
        'prod-vitamin-c-serum-antioxidant-pro-shield',
        'prod-vitamin-b3-serum-pore-sebum-control',
        'prod-skin-hydration-serum-snail-mucin'
      ]
    },
    {
      id: 'anti-aging',
      label: 'Anti-Aging',
      productIds: [
        'prod-retinol-peptide-night-serum',
        'prod-vitamin-c-serum-antioxidant-pro-shield'
      ]
    },
    {
      id: 'repair',
      label: 'Repair',
      productIds: [
        'prod-skin-hydration-serum-snail-mucin',
        'prod-vitamin-b3-serum-pore-sebum-control'
      ]
    },
    {
      id: 'hydration',
      label: 'Hydration',
      productIds: [
        'prod-skin-hydration-serum-snail-mucin',
        'prod-vitamin-b3-serum-pore-sebum-control',
        'prod-retinol-peptide-night-serum'
      ]
    }
  ];
  const BRAND_CATEGORY_FILTERS = [
    { id: 'skincare', label: 'Skincare' },
    { id: 'supplements', label: 'Supplements' },
    { id: 'haircare', label: 'HairCare' },
    { id: 'bodycare', label: 'BodyCare' }
  ];
  const POPULAR_BRAND_DEFINITIONS = [
    {
      id: 'loreal',
      name: "L'Oreal",
      logoUrl: '/images/brands/loreal.png',
      categories: ['skincare', 'supplements', 'haircare', 'bodycare']
    },
    {
      id: 'la-roche-posay',
      name: 'La Roche-Posay',
      logoUrl: '/images/brands/la-roche-posay.png',
      categories: ['skincare']
    },
    {
      id: 'cerave',
      name: 'CeraVe',
      logoUrl: '/images/brands/cerave.png',
      categories: ['skincare']
    },
    {
      id: 'cetaphil',
      name: 'Cetaphil',
      logoUrl: '/images/brands/cetaphil.png',
      categories: ['skincare']
    },
    {
      id: 'bioderma',
      name: 'Bioderma',
      logoUrl: '/images/brands/bioderma.png',
      categories: ['skincare', 'supplements']
    },
    {
      id: 'henkel',
      name: 'Henkel',
      logoUrl: '/images/brands/henkel.png',
      categories: ['supplements', 'haircare']
    },
    {
      id: 'unilever',
      name: 'Unilever',
      logoUrl: '/images/brands/unilever.png',
      categories: ['skincare', 'haircare', 'bodycare']
    },
    {
      id: 'head-shoulders',
      name: 'Head & Shoulders',
      logoUrl: '/images/brands/head-and-shoulders.png',
      categories: ['haircare']
    },
    {
      id: 'nivea',
      name: 'Nivea',
      logoUrl: '/images/brands/nivea.png',
      categories: ['skincare', 'bodycare']
    },
    {
      id: 'axe',
      name: 'Axe',
      logoUrl: '/images/brands/axe.png',
      categories: ['bodycare']
    },
    {
      id: 'garnier',
      name: 'Garnier',
      logoUrl: '/images/brands/garnier.png',
      categories: ['skincare', 'supplements', 'haircare', 'bodycare']
    },
    {
      id: 'dove',
      name: 'Dove',
      logoUrl: '/images/brands/dove.png',
      categories: ['bodycare', 'haircare']
    },
    {
      id: 'schwarzkopf',
      name: 'Schwarzkopf',
      logoUrl: '/images/brands/schwarzkopf.png',
      categories: ['haircare']
    },
    {
      id: 'elseve',
      name: 'Elseve',
      logoUrl: '/images/brands/elseve.png',
      categories: ['supplements', 'haircare']
    },
    {
      id: 'the-body-shop',
      name: 'The Body Shop',
      logoUrl: '/images/brands/the-body-shop.png',
      categories: ['bodycare', 'skincare']
    },
    {
      id: 'cien',
      name: 'Cien',
      logoUrl: '/images/brands/cien.png',
      categories: ['bodycare']
    },
    {
      id: 'balea',
      name: 'Balea',
      logoUrl: '/images/brands/balea.png',
      categories: ['bodycare']
    }
  ];

  /** Offline / partial-API fallback so the carousel always lists all four serums; API data overrides by id. */
  const STATIC_CATALOG_FALLBACK = [
    {
      id: 'prod-vitamin-b3-serum-pore-sebum-control',
      brand: 'Somo',
      name: 'Vitamin B3 Serum | Pore & Sebum Control',
      price: 27.99,
      image_url: '/images/products/vitamin-b3-serum.png',
      category: '10% Niacinamide',
      protocol_stage: 'Sebum Control',
      tags: ['serum', 'niacinamide', 'b3', 'stabilize', 'pore', 'sebum', 'barrier', 'clinical'],
      badge_category: '10% Niacinamide',
      badge_protocol: 'Sebum Control',
      badge_highlight: 'Redness Repair',
      short_description: 'High-potency B3 to balance oil, refine pores, and support the barrier.'
    },
    {
      id: 'prod-retinol-peptide-night-serum',
      brand: 'Somo',
      name: 'Retinol Brightening Night Serum',
      price: 29.99,
      image_url: '/images/products/retinol-brightening-night-serum.png',
      category: 'Anti-Aging',
      protocol_stage: 'Night Serum',
      tags: ['serum', 'retinol', 'peptide', 'night', 'rebuild', 'clinical', 'collagen'],
      badge_category: 'Anti-Aging',
      badge_protocol: 'Night Serum',
      badge_highlight: 'Collagen Boosting',
      short_description: 'Overnight retinol and peptides for texture, firmness, and renewal.'
    },
    {
      id: SNAIL_MUCIN_PRODUCT_ID,
      brand: 'Somo',
      name: SNAIL_MUCIN_TITLE,
      price: 29.99,
      image_url: '/images/products/dark-spot-repair-snail-mucin-serum.png',
      category: 'Glass Skin Serum',
      protocol_stage: 'Skin Repair',
      tags: ['serum', 'snail-mucin', 'hydration', 'barrier', 'collagen', 'centella', 'clinical'],
      badge_category: 'Glass Skin Serum',
      badge_protocol: 'Skin Repair',
      badge_highlight: 'Dark Spot Treatment',
      short_description: 'Dual-action dark spot repair and deep hydration with clinical-grade snail mucin.',
      description: SNAIL_MUCIN_DESCRIPTION
    },
    {
      id: VITAMIN_C_PRODUCT_ID,
      brand: 'Somo',
      name: 'Vitamin C Serum | Antioxidant Pro-Shield',
      price: 21.99,
      image_url: '/images/products/vitamin-c-serum.png',
      category: 'Brightening',
      protocol_stage: 'Dark Spot Corrector',
      tags: ['serum', 'vitamin-c', 'antioxidant', 'protect', 'morning', 'ferulic', 'triple-c', 'clinical', 'photo-protection'],
      badge_category: 'Brightening',
      badge_protocol: 'Dark Spot Corrector',
      badge_highlight: 'Glass Skin Serum',
      short_description: 'Morning antioxidant shield—brighten and defend against daily exposure.'
    }
  ];

  /** Blue / green / purple pills (category, protocol stage, product highlight). */
  const pickColorBadges = (product) => {
    const base = STATIC_CATALOG_FALLBACK.find((x) => x.id === product.id);
    const category = String(product.badge_category || product.category || base?.badge_category || 'Serums').trim();
    const protocol = String(
      product.badge_protocol || product.protocol_stage || base?.badge_protocol || base?.protocol_stage || ''
    ).trim();
    const highlight = String(product.badge_highlight || base?.badge_highlight || '').trim();
    return { category, protocol, highlight };
  };

  const mergeCatalogWithFallback = (apiList) => {
    const byId = new Map();
    for (const p of STATIC_CATALOG_FALLBACK) {
      byId.set(p.id, { ...p });
    }
    if (Array.isArray(apiList)) {
      for (const p of apiList) {
        if (p && p.id) {
          const prev = byId.get(p.id) || {};
          const merged = { ...prev, ...p };
          if (p.id === SNAIL_MUCIN_PRODUCT_ID) {
            merged.name = SNAIL_MUCIN_TITLE;
            merged.short_description = 'Dual-action dark spot repair and deep hydration with clinical-grade snail mucin.';
            merged.description = SNAIL_MUCIN_DESCRIPTION;
            merged.category = 'Glass Skin Serum';
            merged.protocol_stage = 'Skin Repair';
            merged.badge_category = 'Glass Skin Serum';
            merged.badge_protocol = 'Skin Repair';
            merged.badge_highlight = 'Dark Spot Treatment';
          }
          if (p.id === 'prod-retinol-peptide-night-serum') {
            merged.category = 'Anti-Aging';
            merged.protocol_stage = 'Night Serum';
            merged.badge_category = 'Anti-Aging';
            merged.badge_protocol = 'Night Serum';
            merged.badge_highlight = 'Collagen Boosting';
          }
          if (p.id === 'prod-vitamin-b3-serum-pore-sebum-control') {
            merged.category = '10% Niacinamide';
            merged.protocol_stage = 'Sebum Control';
            merged.badge_category = '10% Niacinamide';
            merged.badge_protocol = 'Sebum Control';
            merged.badge_highlight = 'Redness Repair';
          }
          if (p.id === VITAMIN_C_PRODUCT_ID) {
            merged.category = 'Brightening';
            merged.protocol_stage = 'Dark Spot Corrector';
            merged.badge_category = 'Brightening';
            merged.badge_protocol = 'Dark Spot Corrector';
            merged.badge_highlight = 'Glass Skin Serum';
          }
          if (!merged.short_description && prev.short_description) merged.short_description = prev.short_description;
          if (merged.badge_category == null && prev.badge_category) merged.badge_category = prev.badge_category;
          if (merged.badge_protocol == null && prev.badge_protocol) merged.badge_protocol = prev.badge_protocol;
          if (merged.badge_highlight == null && prev.badge_highlight) merged.badge_highlight = prev.badge_highlight;
          byId.set(p.id, merged);
        }
      }
    }
    return FEATURED_PRODUCT_ORDER.map((id) => byId.get(id)).filter(Boolean);
  };

  const formatPrice = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '$0.00';
    return `$${amount.toFixed(2)}`;
  };

  const parseRatingValue = (raw) => {
    const n = Number.parseFloat(String(raw || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 4.9;
  };

  const extractBrand = (product) => {
    const explicit = String(product?.brand || '').trim();
    if (explicit) return explicit;
    const firstBrand = String(product?.brands || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)[0];
    if (firstBrand) return firstBrand;
    const fromName = String(product?.name || '').split('|')[0].trim();
    return fromName ? fromName.split(/\s+/).slice(0, 2).join(' ') : 'Unknown';
  };

  const normalizeProductImageUrl = (product) => {
    if (product && product.id === SNAIL_MUCIN_PRODUCT_ID) {
      return '/images/products/dark-spot-repair-snail-mucin-serum.png';
    }
    const raw = String(
      (product && (product.image_url || product.image || product.imageUrl)) || ''
    ).trim();
    if (!raw) return DEFAULT_ROUTINE_BOTTLE_IMAGE;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
    if (raw.startsWith('/images/products/')) return raw;
    const clean = raw.replace(/^\/+/, '');
    if (clean.startsWith('images/products/')) return `/${clean}`;
    if (clean.startsWith('images/')) return `/images/products/${clean.replace(/^images\//, '')}`;
    return raw.startsWith('/') ? raw : `/${raw}`;
  };

  /** Deep links like `/#assistant/voice` must mount the shell; hash is read inside AssistantExperience. */
  const [showAssistant, setShowAssistant] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.location.hash.startsWith('#assistant');
  });

  useEffect(() => {
    const onHash = () => {
      if (typeof window === 'undefined') return;
      if (window.location.hash.startsWith('#assistant')) setShowAssistant(true);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (checkoutMaintenanceMode && showAssistant) {
      setShowAssistant(false);
    }
  }, [checkoutMaintenanceMode, showAssistant]);
  const [solutionsNav, setSolutionsNav] = useState({ atStart: true, atEnd: false });
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showGetAppModal, setShowGetAppModal] = useState(false);
  const [beforeAfterPct, setBeforeAfterPct] = useState(50);
  const [isDraggingBA, setIsDraggingBA] = useState(false);
  const [baBottleOffset, setBaBottleOffset] = useState({ x: 0, y: 0 });
  const [isDraggingBaBottle, setIsDraggingBaBottle] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [catalogFilterId] = useState('all');
  const [brandCategoryId, setBrandCategoryId] = useState('skincare');
  const [activeChatThread, setActiveChatThread] = useState(0);
  const [visibleChatMessages, setVisibleChatMessages] = useState(1);
  const solutionsViewportRef = useRef(null);
  const routineCarouselRef = useRef(null);
  const baRef = useRef({ active: false, pointerId: null });
  const baBottleRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, baseX: 0, baseY: 0 });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const scrollLocked = showMobileMenu || showAssistant || showGetAppModal;
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!scrollLocked) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [scrollLocked]);

  const handleStartAnalysis = (event) => {
    event.preventDefault();
    if (checkoutMaintenanceMode) return;
    emitCheckoutFunnelEvent('landing_open_assistant', { source: 'cta' });
    setShowAssistant(true);
  };
  const handleOpenGetApp = (event, source = 'nav') => {
    if (event?.preventDefault) event.preventDefault();
    emitCheckoutFunnelEvent('landing_get_app_open', { source });
    if (isLocalHost && typeof window !== 'undefined') {
      window.location.href = localPatientAuthHref;
      return;
    }
    setShowGetAppModal(true);
  };

  const updateBeforeAfterFromEvent = (event) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setBeforeAfterPct(Math.round(x * 100));
  };

  const handleBAPointerDown = (event) => {
    event.preventDefault();
    baRef.current.active = true;
    baRef.current.pointerId = event.pointerId;
    setIsDraggingBA(true);
    updateBeforeAfterFromEvent(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleBAPointerMove = (event) => {
    if (!baRef.current.active) return;
    updateBeforeAfterFromEvent(event);
  };

  const endBADrag = (event) => {
    if (!baRef.current.active) return;
    baRef.current.active = false;
    if (baRef.current.pointerId != null) {
      event.currentTarget.releasePointerCapture?.(baRef.current.pointerId);
    }
    baRef.current.pointerId = null;
    setIsDraggingBA(false);
  };

  const handleBaBottlePointerDown = (event) => {
    event.preventDefault();
    baBottleRef.current.active = true;
    baBottleRef.current.pointerId = event.pointerId;
    baBottleRef.current.startX = event.clientX;
    baBottleRef.current.startY = event.clientY;
    baBottleRef.current.baseX = baBottleOffset.x;
    baBottleRef.current.baseY = baBottleOffset.y;
    setIsDraggingBaBottle(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleBaBottlePointerMove = (event) => {
    if (!baBottleRef.current.active) return;
    const deltaX = event.clientX - baBottleRef.current.startX;
    const deltaY = event.clientY - baBottleRef.current.startY;
    setBaBottleOffset({
      x: clamp(baBottleRef.current.baseX + deltaX, -220, 220),
      y: clamp(baBottleRef.current.baseY + deltaY, -180, 180)
    });
  };

  const endBaBottleDrag = (event) => {
    if (!baBottleRef.current.active) return;
    baBottleRef.current.active = false;
    if (baBottleRef.current.pointerId != null) {
      event.currentTarget.releasePointerCapture?.(baBottleRef.current.pointerId);
    }
    baBottleRef.current.pointerId = null;
    setIsDraggingBaBottle(false);
  };

  useEffect(() => {
    let active = true;
    const fetchJson = async (url) => {
      const res = await fetch(url);
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }
      if (!res.ok || !data?.success) {
        const message = data?.error || data?.message || `Failed (${res.status})`;
        throw new Error(message);
      }
      return data;
    };

    const tryCatalogEndpoints = async () => {
      const merchantQuery = MERCHANT_ID ? `?merchant_id=${encodeURIComponent(MERCHANT_ID)}` : '';
      let lastErr = null;

      for (const base of API_BASE_CANDIDATES) {
        const url = `${base}/api/public/products${merchantQuery}`;
        try {
          const payload = await fetchJson(url);
          return { payload, base };
        } catch (error) {
          lastErr = error;
        }
      }
      throw lastErr || new Error('Failed to load product catalog.');
    };

    const loadProducts = async () => {
      try {
        setProductsLoading(true);
        setProductsError('');
        const { payload } = await tryCatalogEndpoints();
        if (!active) return;
        const sourceProducts = Array.isArray(payload.prescriptions) && payload.prescriptions.length
          ? payload.prescriptions
          : payload.products;
        setProducts(Array.isArray(sourceProducts) ? sourceProducts : []);
      } catch (error) {
        if (!active) return;
        setProducts([]);
        setProductsError(error.message || 'Failed to load products.');
      } finally {
        if (!active) return;
        setProductsLoading(false);
      }
    };
    loadProducts();
    return () => {
      active = false;
    };
  }, [MERCHANT_ID, API_BASE_CANDIDATES]);

  const mergedCatalog = mergeCatalogWithFallback(products);
  const sortedProducts = [...mergedCatalog].sort((a, b) => {
    const aIdx = FEATURED_PRODUCT_ORDER.indexOf(a.id);
    const bIdx = FEATURED_PRODUCT_ORDER.indexOf(b.id);
    const aRank = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
    const bRank = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
    if (aRank !== bRank) return aRank - bRank;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  const productCards = sortedProducts.map((product, index) => {
    const fullName = product.name || `Product ${index + 1}`;
    const parts = fullName.split('|').map((s) => s.trim()).filter(Boolean);
    const titleShort = parts[0] || fullName;
    const displayName = titleShort;
    const colorBadges = pickColorBadges(product);
    const shortDescription =
      (product.short_description || '').trim() ||
      (STATIC_CATALOG_FALLBACK.find((x) => x.id === product.id)?.short_description || '').trim();
    return {
      id: product.id,
      brand: extractBrand(product),
      name: fullName,
      displayName,
      titleShort,
      colorBadges,
      shortDescription,
      size: '30ml',
      rating: '4.9 (Verified)',
      ratingValue: parseRatingValue(product.rating || '4.9'),
      image: normalizeProductImageUrl(product),
      featured: FEATURED_PRODUCT_ORDER.includes(product.id),
      isNew: index === 0,
      price: formatPrice(product.price),
      description: product.description || '',
      prescription_id: product.prescription_id || product.id
    };
  });

  const activeFilter = CATALOG_FILTERS.find((f) => f.id === catalogFilterId) || CATALOG_FILTERS[0];
  const filteredProductCards = Array.isArray(activeFilter.productIds)
    ? productCards.filter((p) => activeFilter.productIds.includes(p.id))
    : productCards;
  const filteredPopularBrands = useMemo(() => {
    return POPULAR_BRAND_DEFINITIONS.filter((brand) => brand.categories.includes(brandCategoryId));
  }, [brandCategoryId, POPULAR_BRAND_DEFINITIONS]);
  const scanSpotlightProduct =
    productCards.find((p) => p.id === VITAMIN_C_PRODUCT_ID) || productCards[0] || null;
  const chatLeadProduct = scanSpotlightProduct || filteredProductCards[0] || productCards[0] || null;
  const chatThreads = useMemo(() => {
    const source = (filteredProductCards.length ? filteredProductCards : productCards).slice(0, 2);
    return source.map((product, idx) => ({
      id: product.id || `chat-${idx}`,
      productName: product.displayName || `Product ${idx + 1}`,
      image: product.image || DEFAULT_ROUTINE_BOTTLE_IMAGE,
      unread: idx === 0 ? 3 : idx === 1 ? 1 : 0,
      preview:
        idx % 2 === 0
          ? 'Is this good for sensitive skin?'
          : 'How should I use this in week one?',
      messages: [
        {
          role: 'patient',
          text: `I scanned ${product.displayName || 'this serum'}. Is this a good fit for sensitive skin and daily use?`
        },
        {
          role: 'guide',
          text: 'Great question. Based on the ingredient profile, start 2-3 nights weekly, then layer moisturizer and daytime SPF.'
        },
        {
          role: 'patient',
          text: 'What should I watch for in week one?'
        },
        {
          role: 'guide',
          text: 'Watch for dryness, redness, or stinging. If that happens, reduce frequency and focus on barrier repair. If symptoms continue, get clinician review.'
        }
      ]
    }));
  }, [filteredProductCards, productCards]);
  const activeThread = chatThreads[activeChatThread] || chatThreads[0] || null;

  useEffect(() => {
    if (!chatThreads.length) return;
    if (activeChatThread > chatThreads.length - 1) {
      setActiveChatThread(0);
      return;
    }
    const currentThread = chatThreads[activeChatThread] || null;
    const cap = currentThread?.messages?.length || 1;
    const startingCount = Math.max(1, Math.min(Number(currentThread?.unread || 1), cap));
    setVisibleChatMessages(startingCount);
    const t = window.setInterval(() => {
      setVisibleChatMessages((n) => (n >= cap ? cap : n + 1));
    }, 900);
    return () => window.clearInterval(t);
  }, [activeChatThread, chatThreads]);

  useEffect(() => {
    const el = routineCarouselRef.current;
    if (!el) return undefined;
    let rafId = 0;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      const resetPoint = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
      if (resetPoint > 0) {
        el.scrollLeft += 0.3;
        if (el.scrollLeft >= resetPoint) el.scrollLeft = 0;
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => {
      stopped = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const updateSolutionsNav = () => {
    const el = solutionsViewportRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 2;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setSolutionsNav({ atStart, atEnd });
  };

  useEffect(() => {
    const onResize = () => updateSolutionsNav();
    window.addEventListener('resize', onResize);
    updateSolutionsNav();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const el = solutionsViewportRef.current;
    if (el) el.scrollLeft = 0;
    const t = window.setTimeout(() => updateSolutionsNav(), 0);
    return () => window.clearTimeout(t);
  }, [brandCategoryId, products.length]);

  const scrollSolutionsBy = (direction) => {
    const el = solutionsViewportRef.current;
    if (!el) return;
    const cards = el.querySelectorAll('.brand-card, .solution-card');
    const first = cards[0];
    const second = cards[1];
    const gap =
      first && second ? second.offsetLeft - first.offsetLeft - first.offsetWidth : 22;
    const stride = first ? first.getBoundingClientRect().width + gap : el.clientWidth;
    el.scrollBy({ left: stride * direction, behavior: 'smooth' });
  };

  return (
    <main className="landing-shell">
      {showAssistant ? (
        <AssistantExperience onClose={() => setShowAssistant(false)} />
      ) : null}
      <GetAppWaitlistOverlay
        open={showGetAppModal}
        onClose={() => setShowGetAppModal(false)}
        apiBaseCandidates={API_BASE_CANDIDATES}
      />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="page page--topbar">
      <header className="top-nav">
        <a href="/" className="brand-mark">
          <img className="brand-mark-logo" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
          <span>Somo</span>
        </a>
        <nav aria-label="Main navigation" className="nav-links">
          <a href="/">Find Care</a>
          <a href="#main-content">How it works</a>
          <a href={isLocalHost ? localPatientAuthHref : '/waitlist'} onClick={(e) => handleOpenGetApp(e, 'top_nav_menu')}>Get the app</a>
        </nav>
        <div className="nav-actions">
          <button
            type="button"
            className={`mobile-menu-toggle${showMobileMenu ? ' is-open' : ''}`}
            aria-label={showMobileMenu ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={showMobileMenu}
            onClick={() => setShowMobileMenu((v) => !v)}
          >
            <span className="mobile-menu-toggle__bars" aria-hidden="true">
              <span className="mobile-menu-toggle__bar" />
              <span className="mobile-menu-toggle__bar" />
              <span className="mobile-menu-toggle__bar" />
            </span>
          </button>
        </div>
      </header>
      {showMobileMenu && (
        <div className="mobile-menu-panel" role="dialog" aria-label="Mobile navigation menu">
          <a href="/" onClick={() => setShowMobileMenu(false)}>Find Care</a>
          <a href="#main-content" onClick={() => setShowMobileMenu(false)}>How it works</a>
          <a
            href={isLocalHost ? localPatientAuthHref : '/waitlist'}
            onClick={(e) => {
              setShowMobileMenu(false);
              handleOpenGetApp(e, 'mobile_nav_menu');
            }}
          >
            App
          </a>
        </div>
      )}
      </div>

      <section id="main-content" className="hero hero-cal hero-cal--fullscreen">
        <div className="hero-cal-grid">
          <div id="demo" className="hero-cal-visual" aria-label="Product scan preview">
            <img
              src="/images/hero/phone-mockup.png"
              alt="Scan a skincare product barcode to see ingredients and formulation details in the app"
              className="hero-cal-mockup"
              width={1200}
              height={900}
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="hero-cal-copy">
            <div className="hero-kicker-row">
              <div className="hero-kicker-seal-wrap">
                <img
                  className="hero-kicker-seal"
                  src="/images/branding/approvedicon.png"
                  alt="Doctor approved"
                  width={160}
                  height={160}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <p className="kicker kicker--social kicker--cal">
                <span className="kicker-avatars" aria-hidden="true">
                  <img src={doctorAvatarPng} alt="" />
                </span>
                <span className="kicker-text">
                  Loved by doctors with <span className="kicker-star">⭐</span> 4.9 rating
                </span>
              </p>
            </div>
            <h1 className="hero-title hero-title--cal">
              <span className="hero-title-line1">Know what&apos;s really inside your products</span>
            </h1>
            <p className="subtext subtext--cal">
              Scan any product barcode to instantly reveal product ingredients and check exactly what&apos;s inside.
            </p>
            <div className="hero-ctas hero-ctas--cal">
              {!checkoutMaintenanceMode ? (
                <a className="btn-cal btn-cal--primary" href="/waitlist" onClick={handleStartAnalysis}>
                  Start Analysis
                </a>
              ) : null}
              <button
                type="button"
                className="btn-cal btn-cal--get-app"
                aria-label={isLocalHost ? 'Get The App — open patient sign in' : 'Get The App — join the Somo waitlist'}
                onClick={() => {
                  handleOpenGetApp(null, 'hero');
                }}
              >
                Get The App
              </button>
            </div>
          </div>
        </div>
      </section>

      {!showAssistant && !checkoutMaintenanceMode ? (
        <button
          type="button"
          className="panda-fab"
          onClick={(e) => {
            e.preventDefault();
            emitCheckoutFunnelEvent('landing_panda_fab', { source: 'spinning_sc_fab' });
            setShowAssistant(true);
          }}
          aria-label="Open Somo assistant"
        >
          <span className="panda-fab__spin" aria-hidden="true">
            S<span className="panda-fab__amp">&amp;</span>C
          </span>
        </button>
      ) : null}

      <div className="page page--below-fold">
      <section className="scan-results" aria-label="Ask Somo questions" id="scan-results">
        <div className="scan-results-intro">
          <p className="scan-results-badge">
            <img className="scan-badge-icon" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
            <span>SKIN &amp; CARE QUESTIONS</span>
          </p>
          <h2 className="scan-results-title">Ask Somo Questions</h2>
          <p className="scan-results-sub">
            Get clinically backed product guidance with clear answers on ingredients, routine fit, and daily skincare
            choices you can trust.
          </p>
        </div>

        <div className="scan-chat-layout">
          <div className="scan-chat-cluster">
            <aside className="scan-chat-threads" aria-label="Saved product conversations">
              {chatThreads.map((thread, idx) => (
                <button
                  key={thread.id}
                  type="button"
                  className={`scan-thread-item ${idx === activeChatThread ? 'active' : ''}`}
                  onClick={() => setActiveChatThread(idx)}
                  aria-label={`Open ${thread.productName} conversation`}
                  title={thread.productName}
                >
                  <img src={thread.image} alt={thread.productName} />
                  {thread.unread > 0 ? <span className="scan-thread-badge">{thread.unread}</span> : null}
                </button>
              ))}
            </aside>

            <article className="scan-chat-shell" aria-label="Sample customer conversation">
              <header className="scan-chat-header">
                <img
                  className="scan-chat-header-img"
                  src={activeThread?.image || chatLeadProduct?.image || DEFAULT_ROUTINE_BOTTLE_IMAGE}
                  alt={activeThread?.productName || chatLeadProduct?.displayName || 'Product'}
                />
                <div>
                  <p className="scan-chat-header-title">{activeThread?.productName || chatLeadProduct?.displayName || 'Vitamin C Serum'}</p>
                  <p className="scan-chat-header-sub">{activeThread?.preview || 'Product-first conversation'}</p>
                </div>
              </header>

              <div className="scan-chat-messages" role="list" aria-label="Product-first chat preview">
                <div className="scan-chat-time">
                  <span className="scan-chat-live-dot" aria-hidden="true" />
                  Live conversation preview
                </div>
                {(activeThread?.messages || []).slice(0, visibleChatMessages).map((msg, idx) => (
                  <article
                    key={`${activeThread?.id || 'thread'}-${idx}`}
                    className={`scan-chat-msg ${msg.role === 'guide' ? 'scan-chat-msg--guide' : 'scan-chat-msg--patient'}`}
                    role="listitem"
                  >
                    <div className="scan-chat-bubble">{msg.text}</div>
                  </article>
                ))}
                {visibleChatMessages < (activeThread?.messages?.length || 0) ? (
                  <article className="scan-chat-msg scan-chat-msg--guide" role="listitem" aria-label="Typing">
                    <div className="scan-chat-bubble scan-chat-bubble--typing">
                      <span className="scan-typing-dot" />
                      <span className="scan-typing-dot" />
                      <span className="scan-typing-dot" />
                    </div>
                  </article>
                ) : null}
              </div>

              <footer className="scan-chat-input">
                <button type="button" className="scan-chat-input-icon" aria-label="Attach product image">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 7a2 2 0 0 1 2-2h2l1.2-1.4c.2-.23.49-.36.8-.36h2c.31 0 .6.13.8.36L15.99 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7Z" />
                    <circle cx="12" cy="12" r="3.5" />
                  </svg>
                </button>
                <button type="button" className="scan-chat-input-icon" aria-label="Add emoji reaction">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="9" cy="10" r="1.1" />
                    <circle cx="15" cy="10" r="1.1" />
                    <path d="M8.4 14.2c.9 1.1 2.2 1.8 3.6 1.8 1.4 0 2.7-.7 3.6-1.8" />
                  </svg>
                </button>
                <div className="scan-chat-input-field">Type your message here!</div>
                <button type="button" className="scan-chat-input-icon" aria-label="Send voice message">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" />
                    <path d="M12 17v4" />
                    <path d="M8.5 21h7" />
                  </svg>
                </button>
              </footer>
            </article>
          </div>

          <div className="scan-results-center" aria-label="Live scan preview">
            <div className="scan-phone">
              <img src="/images/sections/scan-middle-face.png" alt="Live skin scan preview" className="scan-phone-img" />
              <div className="scan-cv-overlay" aria-hidden="true">
                <div className="scan-cv-top">
                  <span className="scan-cv-tag">LIVE</span>
                  <span className="scan-cv-status">Face scan in progress</span>
                </div>
                <div className="scan-cv-face-mesh" />
                <div className="scan-cv-corners">
                  <i className="cv-corner tl" />
                  <i className="cv-corner tr" />
                  <i className="cv-corner bl" />
                  <i className="cv-corner br" />
                </div>
              </div>
              <div className="scan-frame-corners" aria-hidden="true">
                <span className="corner tl" />
                <span className="corner tr" />
                <span className="corner bl" />
                <span className="corner br" />
              </div>
              <div className="scan-phone-overlay" aria-hidden="true" />
            </div>
          </div>

          <aside className="scan-trust-panel" aria-label="Clinical trust and safety notes">
            <div className="scan-faq-header" aria-hidden="true">
              <img className="pill-panda" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
              <span>CLINICAL TRUST</span>
            </div>
            <h3 className="scan-faq-title">Trusted answers for real skincare decisions</h3>
            <div className="scan-faq" aria-label="Trust and safety frequently asked questions">
              <details className="faq-item" open>
                <summary>
                  How is guidance personalized?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  We start with your scanned product and ingredients, then tailor routine guidance to your skin concerns.
                </p>
              </details>
              <details className="faq-item">
                <summary>
                  Is this medical advice?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  Guidance supports everyday decisions. For persistent, painful, or worsening symptoms, continue with a
                  clinician review.
                </p>
              </details>
              <details className="faq-item">
                <summary>
                  What should I ask first?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>Ask about ingredient fit, frequency, and what to monitor in your first week.</p>
              </details>
            </div>
            {!checkoutMaintenanceMode ? (
              <button className="scan-primary-btn scan-primary-btn--inline" type="button" onClick={handleStartAnalysis}>
                Ask now
              </button>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="routine-track" aria-label="Track your skincare routines">
        <div className="routine-track-head">
          <h2>Track your skincare routines</h2>
          <p>
            Join us in taking skincare <em>beyond the bathroom</em>
          </p>
        </div>
        <div className="routine-track-carousel" aria-label="Routine inspiration feed" ref={routineCarouselRef}>
          <article className="routine-track-card routine-track-card--short">
            <img src="/images/form.svg" alt="Routine snapshot card" loading="lazy" />
          </article>
          <article className="routine-track-card routine-track-card--medium">
            <img src="/images/give up.svg" alt="Skincare creator content" loading="lazy" />
          </article>
          <article className="routine-track-card routine-track-card--tall">
            <video
              src="/videos/routine-carousel.mp4"
              className="routine-track-video"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              controls={false}
            />
          </article>
          <article className="routine-track-card routine-track-card--medium">
            <img src="/images/give up (1).svg" alt="Product routine clip" loading="lazy" />
          </article>
          <article className="routine-track-card routine-track-card--short">
            <video
              src="/videos/routine-eye-patch.mp4"
              className="routine-track-video"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              controls={false}
            />
          </article>

          <article className="routine-track-card routine-track-card--short" aria-hidden="true">
            <img src="/images/form.svg" alt="" loading="lazy" />
          </article>
          <article className="routine-track-card routine-track-card--medium" aria-hidden="true">
            <img src="/images/give up.svg" alt="" loading="lazy" />
          </article>
          <article className="routine-track-card routine-track-card--tall" aria-hidden="true">
            <video
              src="/videos/routine-carousel.mp4"
              className="routine-track-video"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              controls={false}
            />
          </article>
          <article className="routine-track-card routine-track-card--medium" aria-hidden="true">
            <img src="/images/give up (1).svg" alt="" loading="lazy" />
          </article>
          <article className="routine-track-card routine-track-card--short" aria-hidden="true">
            <video
              src="/videos/routine-eye-patch.mp4"
              className="routine-track-video"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              controls={false}
            />
          </article>
        </div>
      </section>

      <section className="solutions" aria-label="Popular skincare brands" id="products">
        <p className="solutions-kicker">
          <img className="pill-panda" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
          <span>SCAN POPULAR BRANDS</span>
        </p>
        <h2>Most Popular Brands</h2>

        <div className="solutions-shell">
          <div className="solutions-controls">
            <p className="solutions-browse-copy">Browse by category</p>
            <div className="solutions-controls-right" role="tablist" aria-label="Filter brand categories">
              {BRAND_CATEGORY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={brandCategoryId === f.id}
                  className={`solutions-tab ${brandCategoryId === f.id ? 'active' : ''}`}
                  onClick={() => setBrandCategoryId(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="brand-carousel" aria-label="Popular brand logo carousel">
            <button
              type="button"
              className="solutions-nav prev"
              aria-label="Previous brands"
              onClick={() => scrollSolutionsBy(-1)}
              disabled={solutionsNav.atStart}
            >
              ‹
            </button>

            <div className="brand-carousel-viewport" ref={solutionsViewportRef} onScroll={updateSolutionsNav}>
              <div className="brand-carousel-track">
                {filteredPopularBrands.map((brand) => (
                  <article key={brand.id} className="brand-card" aria-label={brand.name}>
                    <div className="brand-logo-badge">
                      {brand.logoUrl ? (
                        <img
                          src={brand.logoUrl}
                          alt={`${brand.name} logo`}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="solutions-nav next"
              aria-label="Next brands"
              onClick={() => scrollSolutionsBy(1)}
              disabled={solutionsNav.atEnd}
            >
              ›
            </button>
          </div>
        </div>
      </section>

      <section className="before-after" aria-label="Before and after skin story" id="before-after">
        <div className="before-after-shell">
          <div className="before-after-left">
            <h2>Your Skin’s Story: Before &amp; After</h2>
            <p>
              Discover the impact of science-backed skincare. See real transformations and learn what to do next—guided by
              AI scan insights.
            </p>
          </div>

          <div className="before-after-media" aria-label="Before and after slider">
            <div
              className={`ba-stage ${isDraggingBA ? 'dragging' : ''}`}
              role="group"
              aria-label="Before and after comparison"
              onPointerDown={handleBAPointerDown}
              onPointerMove={handleBAPointerMove}
              onPointerUp={endBADrag}
              onPointerCancel={endBADrag}
            >
              <img className="ba-img" src="/images/sections/before-face.png" alt="Before" />
              <div className="ba-afterClip" style={{ width: `${beforeAfterPct}%` }}>
                <img className="ba-img" src="/images/sections/after-face.png" alt="After" />
              </div>
              <div className="ba-handle" style={{ left: `${beforeAfterPct}%` }} aria-hidden="true">
                <div className="ba-line" />
                <div className="ba-knob" />
              </div>
            </div>
          </div>

          <aside className="before-after-right" aria-label="Patient testimonials" id="patient-reviews">
            <div className="ba-spotlight ba-spotlight--reviews" aria-label="What our patients say">
              <p className="ba-spotlight-kicker">What our patients say</p>
              <div className="reviews-track-wrap reviews-track-wrap--inline" aria-label="Auto-moving testimonials">
                <div className="reviews-track">
                  <article className="review-mini-card">
                    <div className="review-mini-stars">★★★★★</div>
                    <p>
                      The personalized approach made all the difference. They didn&apos;t rush anything and created a plan
                      that worked for my skin.
                    </p>
                    <div className="review-mini-author">
                      <span className="avatar a2" aria-hidden="true" />
                      <div>
                        <strong>Olivia Chen</strong>
                        <small>Dermatology Nurse</small>
                      </div>
                    </div>
                  </article>

                  <article className="review-mini-card">
                    <div className="review-mini-stars">★★★★★</div>
                    <p>
                      My acne finally cleared after years of trying everything. The treatment plan was simple, clear, and
                      effective.
                    </p>
                    <div className="review-mini-author">
                      <span className="avatar a1" aria-hidden="true" />
                      <div>
                        <strong>Sofia Hale</strong>
                        <small>Aesthetic Clinician</small>
                      </div>
                    </div>
                  </article>

                  <article className="review-mini-card">
                    <div className="review-mini-stars">★★★★★</div>
                    <p>
                      Professional, clean clinic with advanced tools. I felt informed at every step and saw visible
                      improvement quickly.
                    </p>
                    <div className="review-mini-author">
                      <span className="avatar a3" aria-hidden="true" />
                      <div>
                        <strong>Priya Mehta</strong>
                        <small>General Practitioner</small>
                      </div>
                    </div>
                  </article>

                  <article className="review-mini-card">
                    <div className="review-mini-stars">★★★★★</div>
                    <p>
                      The personalized approach made all the difference. They didn&apos;t rush anything and created a plan
                      that worked for my skin.
                    </p>
                    <div className="review-mini-author">
                      <span className="avatar a2" aria-hidden="true" />
                      <div>
                        <strong>Olivia Chen</strong>
                        <small>Dermatology Nurse</small>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
              <button
                type="button"
                className="btn-cal btn-cal--get-app ba-reviews-get-app"
                aria-label={isLocalHost ? 'Get The App — open patient sign in' : 'Get The App — join the Somo waitlist'}
                onClick={() => {
                  handleOpenGetApp(null, 'reviews_section');
                }}
              >
                Get The App
              </button>
            </div>
          </aside>
        </div>
      </section>

      <section className="contact-us" aria-label="Request an appointment" id="contact">
        <div className="contact-grid">
          <div className="contact-form-card">
            <h2>Request an appointment</h2>
            <p>Fill out the form below, and we&apos;ll contact you shortly.</p>
            <form className="contact-form" onSubmit={(e) => e.preventDefault()}>
              <label>
                Name*
                <input type="text" placeholder="Your name" />
              </label>
              <label>
                Email*
                <input type="email" placeholder="Email address" />
              </label>
              <label>
                Phone*
                <input type="tel" placeholder="Phone number" />
              </label>
              <label>
                Therapy*
                <select defaultValue="">
                  <option value="" disabled>Select</option>
                  <option>Acne treatment</option>
                  <option>Laser therapy</option>
                  <option>Pigmentation care</option>
                </select>
              </label>
              <label className="wide">
                How we can help?
                <textarea rows="3" placeholder="Type here" />
              </label>
              <label className="wide checkbox-row">
                <input type="checkbox" />
                <span>I agree to allow the clinic to contact me regarding my appointment.</span>
              </label>
              <div className="wide contact-actions">
                <button className="btn-primary contact-book-btn" type="submit">Send</button>
                <small>We&apos;ll reply within 24-48h.</small>
              </div>
            </form>
          </div>

          <a
            className="contact-visual-card"
            href="/waitlist"
            onClick={handleStartAnalysis}
            aria-label="Open get app waitlist for general inquiries"
          >
            <img src="/images/hero/contact-right-hero.png" alt="General inquiries" />
            <div className="contact-overlay">
              <span className="contact-overlay-icon" aria-hidden="true">✿</span>
              <p>General inquiries</p>
              <span>☏ +1 363 763 4690</span>
              <span>✉ info@myskinandcare.com</span>
            </div>
          </a>
        </div>
      </section>

      <footer className="site-footer" aria-label="Footer">
        <div id="bestsellers" />
        <div className="site-footer-shell">
          <div className="site-footer-top">
            <div className="site-footer-main">
              <div className="site-footer-overlay">
                <div className="site-footer-copy">
                  <p className="site-footer-kicker">SKIN &amp; CARE</p>
                  <h2>Healthcare that feels personal.</h2>
                  <p>
                    Scan any product barcode to instantly reveal product ingredients and check exactly what&apos;s inside.
                  </p>
                  <div className="site-footer-ctas">
                    {!checkoutMaintenanceMode ? (
                      <a
                        className="btn-cal btn-cal--primary"
                        href="/waitlist"
                        onClick={handleStartAnalysis}
                      >
                        Start Analysis
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="btn-cal btn-cal--get-app"
                      aria-label={isLocalHost ? 'Get The App — open patient sign in' : 'Get The App — join the Somo waitlist'}
                      onClick={() => {
                        handleOpenGetApp(null, 'footer');
                      }}
                    >
                      Get The App
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="site-footer-bottom">
              <div className="site-footer-brand">
                <img src="/images/branding/logo-panda.png" alt="Somo logo" />
                <span>Somo</span>
              </div>
              <p className="site-footer-meta">
                © {new Date().getFullYear()} Somo. All rights reserved. New York, New York USA.
              </p>
            </div>
          </div>
        </div>
      </footer>
      </div>

    </main>
  );
}

export function mountApp() {
const container = document.getElementById('root');
  if (!container) return;
  if (typeof window !== 'undefined' && window.location.pathname === '/how-it-works') {
    const qs = new URLSearchParams(window.location.search);
    if (!qs.has('doc')) qs.set('doc', 'how-it-works');
    const search = qs.toString();
    window.history.replaceState(window.history.state, '', search ? `/?${search}` : '/?doc=how-it-works');
  }
  createRoot(container).render(
    <FindCareCoveragePage
      apiBaseCandidates={[
        middlewareApiBaseFromLocation(process.env.REACT_APP_API_BASE || '', typeof window !== 'undefined' && window.location ? {
          hostname: window.location.hostname,
          port: window.location.port,
          origin: window.location.origin
        } : null),
        FALLBACK_PAYOR_API_BASE,
        typeof window !== 'undefined' ? window.location.origin : ''
      ].filter(Boolean)}
      isLocalHost={typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)}
      localPatientAuthHref="/patients/patient-login.html"
    />
  );
}

mountApp();

