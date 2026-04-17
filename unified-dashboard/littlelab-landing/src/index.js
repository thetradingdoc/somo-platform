import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AssistantExperience from './AssistantExperience';
import { normalizeHttpApiBase } from './landingAssistantApi';
import './skin-care-tokens.css';
import './styles.css';
/** Doctor headshot for hero kicker (distinct from approved seal). Served from `public/images/branding/`. */
const doctorAvatarPng = '/images/branding/doc-avatar.png';

/** Routine-band / marketing bottle art (`public/images` → CRA `build`). New filename avoids stale cache on `routine-bottle.png`. */
const DEFAULT_ROUTINE_BOTTLE_IMAGE = '/images/products/effaclar-routine-bottle.png';

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
              We&apos;ll email <strong>{email}</strong> when the Skin &amp; Care app is ready to download.
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

function Root() {
  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const configuredApiBase = normalizeHttpApiBase(process.env.REACT_APP_API_BASE || '');
  // Stable reference so catalog-loading effect does not re-fire on every render.
  const API_BASE_CANDIDATES = useMemo(
    () =>
      configuredApiBase
        ? [configuredApiBase]
        : (isLocalHost ? ['http://localhost:4000'] : [window.location.origin]),
    [configuredApiBase, isLocalHost]
  );
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
      brand: 'Skin & Care',
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
      brand: 'Skin & Care',
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
      brand: 'Skin & Care',
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
      brand: 'Skin & Care',
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
          <span>Skin &amp; Care</span>
        </a>
        <nav aria-label="Main navigation" className="nav-links">
          <a href="#products">Products</a>
          <a href="#scan-results">Skin Diagnosis</a>
          <a href="#before-after">New</a>
          <a href="#patient-reviews">Bestsellers</a>
          <a href="/waitlist" onClick={(e) => handleOpenGetApp(e, 'top_nav_menu')}>App</a>
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
          <a href="#products" onClick={() => setShowMobileMenu(false)}>Products</a>
          <a href="#scan-results" onClick={() => setShowMobileMenu(false)}>Skin Diagnosis</a>
          <a href="#before-after" onClick={() => setShowMobileMenu(false)}>New</a>
          <a href="#patient-reviews" onClick={() => setShowMobileMenu(false)}>Bestsellers</a>
          <a
            href="/waitlist"
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
                aria-label="Get The App — join the Skin and Care waitlist"
                onClick={() => {
                  emitCheckoutFunnelEvent('landing_get_app_open', { source: 'hero' });
                  setShowGetAppModal(true);
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
          aria-label="Open Skin and Care assistant"
        >
          <span className="panda-fab__spin" aria-hidden="true">
            S<span className="panda-fab__amp">&amp;</span>C
          </span>
        </button>
      ) : null}

      <div className="page page--below-fold">
      <section className="scan-results" aria-label="Ask Skin and Care questions" id="scan-results">
        <div className="scan-results-intro">
          <p className="scan-results-badge">
            <img className="scan-badge-icon" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
            <span>SKIN &amp; CARE QUESTIONS</span>
          </p>
          <h2 className="scan-results-title">Ask Skin &amp; Care Questions</h2>
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
                aria-label="Get The App — join the Skin and Care waitlist"
                onClick={() => {
                  emitCheckoutFunnelEvent('landing_get_app_open', { source: 'reviews_section' });
                  setShowGetAppModal(true);
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
                      aria-label="Get The App — join the Skin and Care waitlist"
                      onClick={() => {
                        emitCheckoutFunnelEvent('landing_get_app_open', { source: 'footer' });
                        setShowGetAppModal(true);
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
                <img src="/images/branding/logo-panda.png" alt="Skin &amp; Care logo" />
                <span>Skin &amp; Care</span>
              </div>
              <p className="site-footer-meta">
                © {new Date().getFullYear()} Skin &amp; Care. All rights reserved. New York, New York USA.
              </p>
            </div>
          </div>
        </div>
      </footer>
      </div>

    </main>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<Root />);

