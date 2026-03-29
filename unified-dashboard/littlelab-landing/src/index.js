import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useRAGSearch } from './useRAGSearch';

function emitCheckoutFunnelEvent(name, detail) {
  try {
    if (typeof window !== 'undefined' && Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...(detail || {}) });
    }
    window.dispatchEvent(new CustomEvent('checkout-funnel', { detail: { name, ...(detail || {}) } }));
  } catch (_) {}
}

function Root() {
  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const configuredApiBase = process.env.REACT_APP_API_BASE || '';
  const API_BASE_CANDIDATES = configuredApiBase
    ? [configuredApiBase]
    : (isLocalHost ? ['http://localhost:4010', 'http://localhost:4000'] : [window.location.origin]);
  const MERCHANT_ID = process.env.REACT_APP_MERCHANT_ID || '';
  /** Patient portal HTML (served by middleware). Handoff: login → dashboard with product context (no price in URL). */
  const PATIENT_PORTAL_PREFIX = process.env.REACT_APP_PATIENT_PORTAL_PREFIX || '/unified-dashboard/patients';
  /** When `false`, hide chat-first “Ask” CTA; buy-now remains (gradual rollout). Default: chat-first on. */
  const CHAT_FIRST_CHECKOUT = process.env.REACT_APP_CHAT_FIRST_CHECKOUT !== 'false';
  const FEATURED_PRODUCT_ORDER = [
    'prod-vitamin-b3-serum-pore-sebum-control',
    'prod-retinol-peptide-night-serum',
    'prod-skin-hydration-serum-snail-mucin',
    'prod-vitamin-c-serum-antioxidant-pro-shield'
  ];

  /** Filter tabs: one per serum + all (matches product ids). */
  const CATALOG_FILTERS = [
    { id: 'all', label: 'All serums' },
    { id: 'prod-vitamin-b3-serum-pore-sebum-control', label: 'Vitamin B3 · Pores & oil' },
    { id: 'prod-retinol-peptide-night-serum', label: 'Retinol · Night' },
    { id: 'prod-skin-hydration-serum-snail-mucin', label: 'Snail · Hydration' },
    { id: 'prod-vitamin-c-serum-antioxidant-pro-shield', label: 'Vitamin C · Protect' }
  ];

  /** Offline / partial-API fallback so the carousel always lists all four serums; API data overrides by id. */
  const STATIC_CATALOG_FALLBACK = [
    {
      id: 'prod-vitamin-b3-serum-pore-sebum-control',
      name: 'Vitamin B3 Serum | Pore & Sebum Control',
      price: 27.99,
      image_url: '/images/products/vitamin-b3-serum.png',
      category: 'Serums',
      protocol_stage: 'Stabilize',
      tags: ['serum', 'niacinamide', 'b3', 'stabilize', 'pore', 'sebum', 'barrier', 'clinical'],
      badge_category: 'Serums',
      badge_protocol: 'Stabilize',
      badge_highlight: 'Pore & Sebum Control',
      short_description: 'High-potency B3 to balance oil, refine pores, and support the barrier.'
    },
    {
      id: 'prod-retinol-peptide-night-serum',
      name: 'Retinol + Peptide Night Serum',
      price: 29.99,
      image_url: '/images/products/retinol-peptide-night-serum.png',
      category: 'Serums',
      protocol_stage: 'Rebuild',
      tags: ['serum', 'retinol', 'peptide', 'night', 'rebuild', 'clinical', 'collagen'],
      badge_category: 'Serums',
      badge_protocol: 'Rebuild',
      badge_highlight: 'Peptide night',
      short_description: 'Overnight retinol and peptides for texture, firmness, and renewal.'
    },
    {
      id: 'prod-skin-hydration-serum-snail-mucin',
      name: 'Skin Hydration Serum | Snail Mucin',
      price: 29.99,
      image_url: '/images/products/snail-mucin-serum.png',
      category: 'Serums',
      protocol_stage: 'Stabilize',
      tags: ['serum', 'snail-mucin', 'hydration', 'barrier', 'collagen', 'centella', 'clinical'],
      badge_category: 'Serums',
      badge_protocol: 'Stabilize',
      badge_highlight: 'Snail mucin',
      short_description: 'Deep hydration and barrier repair with snail mucin and calming botanicals.'
    },
    {
      id: 'prod-vitamin-c-serum-antioxidant-pro-shield',
      name: 'Vitamin C Serum | Antioxidant Pro-Shield',
      price: 21.99,
      image_url: '/images/products/vitamin-c-serum.png',
      category: 'Serums',
      protocol_stage: 'Protect',
      tags: ['serum', 'vitamin-c', 'antioxidant', 'protect', 'morning', 'ferulic', 'triple-c', 'clinical', 'photo-protection'],
      badge_category: 'Serums',
      badge_protocol: 'Protect',
      badge_highlight: 'Antioxidant Pro-Shield',
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

  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showPortalModal, setShowPortalModal] = useState(false);
  const [bottleOffset, setBottleOffset] = useState({ x: 0, y: 0 });
  const [isDraggingBottle, setIsDraggingBottle] = useState(false);
  const [solutionsNav, setSolutionsNav] = useState({ atStart: true, atEnd: false });
  const [scanQuery, setScanQuery] = useState('collagen levels sun damage dark spots acne routine');
  const [activeInsightId, setActiveInsightId] = useState(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [beforeAfterPct, setBeforeAfterPct] = useState(50);
  const [isDraggingBA, setIsDraggingBA] = useState(false);
  const [baBottleOffset, setBaBottleOffset] = useState({ x: 0, y: 0 });
  const [isDraggingBaBottle, setIsDraggingBaBottle] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [checkoutBusyProductId, setCheckoutBusyProductId] = useState(null);
  const [askBusyProductId, setAskBusyProductId] = useState(null);
  const [catalogFilterId, setCatalogFilterId] = useState('all');
  const solutionsViewportRef = useRef(null);
  const baRef = useRef({ active: false, pointerId: null });
  const baBottleRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const dragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const { query: ragQuery, setQuery: setRagQuery, cards: ragCards, loading: ragLoading, error: ragError, empty: ragEmpty } = useRAGSearch();

  useEffect(() => {
    setRagQuery(scanQuery);
  }, [scanQuery, setRagQuery]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previous = document.body.style.overflow;
    if (showMobileMenu) document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [showMobileMenu]);

  const handleBottlePointerDown = (event) => {
    if (window.matchMedia('(max-width: 640px)').matches) return;
    event.preventDefault();
    dragRef.current.active = true;
    dragRef.current.pointerId = event.pointerId;
    dragRef.current.startX = event.clientX;
    dragRef.current.startY = event.clientY;
    dragRef.current.baseX = bottleOffset.x;
    dragRef.current.baseY = bottleOffset.y;
    setIsDraggingBottle(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleBottlePointerMove = (event) => {
    if (!dragRef.current.active) return;
    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    setBottleOffset({
      x: clamp(dragRef.current.baseX + deltaX, -260, 260),
      y: clamp(dragRef.current.baseY + deltaY, -180, 180)
    });
  };

  const endBottleDrag = (event) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (dragRef.current.pointerId != null) {
      event.currentTarget.releasePointerCapture?.(dragRef.current.pointerId);
    }
    dragRef.current.pointerId = null;
    setIsDraggingBottle(false);
  };

  const handleWatchDemo = (event) => {
    event.preventDefault();
    setShowDemoModal(true);
  };

  const handleStartAnalysis = (event) => {
    event.preventDefault();
    setShowPortalModal(true);
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
      const providerQuery = MERCHANT_ID ? `?provider_id=${encodeURIComponent(MERCHANT_ID)}` : '';
      const merchantQuery = MERCHANT_ID ? `?merchant_id=${encodeURIComponent(MERCHANT_ID)}` : '';
      let lastErr = null;

      for (const base of API_BASE_CANDIDATES) {
        const attempts = [
          `${base}/api/public/prescriptions${providerQuery}`,
          `${base}/api/public/products${merchantQuery}`
        ];
        for (const url of attempts) {
          try {
            const payload = await fetchJson(url);
            return { payload, base };
          } catch (error) {
            lastErr = error;
          }
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
      name: fullName,
      displayName,
      titleShort,
      colorBadges,
      shortDescription,
      size: '30ml',
      rating: '4.9 (Verified)',
      image: product.image_url || '/images/products/routine-bottle.png',
      featured: FEATURED_PRODUCT_ORDER.includes(product.id),
      isNew: index === 0,
      price: formatPrice(product.price),
      description: product.description || '',
      prescription_id: product.prescription_id || product.id
    };
  });

  const filteredProductCards =
    catalogFilterId === 'all' ? productCards : productCards.filter((p) => p.id === catalogFilterId);

  const buildAskAboutProductUrl = (product) => {
    const params = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      product_id: product.id,
      bridge: '1'
    });
    const name = (product.displayName || product.name || '').trim();
    if (name) params.set('product_name', name.slice(0, 160));
    if (MERCHANT_ID) params.set('provider_id', MERCHANT_ID);
    const returnTo = `${PATIENT_PORTAL_PREFIX}/checkout-chat.html?${params.toString()}`;
    return `${PATIENT_PORTAL_PREFIX}/patient-login.html?return=${encodeURIComponent(returnTo)}`;
  };

  const handleStartProductCheckout = async (product) => {
    const email = window.prompt('Enter your email for checkout:');
    if (!email) return;

    try {
      emitCheckoutFunnelEvent('landing_cta_buy', { product_id: product.id, source: 'landing' });
      setCheckoutBusyProductId(product.id);
      const body = {
        provider_id: MERCHANT_ID || undefined,
        email,
        name: email.split('@')[0] || 'Customer',
        prescription_id: product.prescription_id || product.id,
        quantity: 1,
        payment_method: 'direct_stripe'
      };
      let data = null;
      let lastErr = null;
      for (const base of API_BASE_CANDIDATES) {
        try {
          const res = await fetch(`${base}/api/public/checkout/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const payload = await res.json();
          if (!res.ok || !payload?.success) {
            throw new Error(payload?.error || payload?.message || `Checkout failed (${res.status})`);
          }
          data = payload;
          break;
        } catch (error) {
          lastErr = error;
        }
      }
      if (!data) {
        throw lastErr || new Error('Failed to start checkout.');
      }

      const checkoutId = data.checkout?.checkout_id;
      const paymentLink = data.checkout?.payment_link;
      if (paymentLink) {
        window.location.assign(paymentLink);
        return;
      }
      const promptLines = [
        `Checkout started for ${product.name}.`,
        checkoutId ? `Checkout ID: ${checkoutId}` : null,
        data.checkout?.client_secret ? 'Complete payment in the flow shown by your app.' : null
      ].filter(Boolean);
      window.alert(promptLines.length ? promptLines.join('\n') : 'Checkout started.');
    } catch (error) {
      window.alert(`Checkout failed: ${error.message}`);
    } finally {
      setCheckoutBusyProductId(null);
    }
  };

  const defaultInsights = [
    {
      id: 'collagen',
      label: 'Collagen Levels',
      summary: "Collagen supports structure and elasticity. Lifestyle, sun exposure, and hydration can affect the way skin looks over time."
    },
    {
      id: 'sun',
      label: 'Sun Damage',
      summary: "UV exposure can contribute to uneven tone and visible texture. Daily SPF and gentle actives can improve long‑term outcomes."
    },
    {
      id: 'concentration',
      label: 'Concentration',
      summary: "Consistency matters. A simple routine applied regularly is often more effective than stacking too many products at once."
    }
  ];

  const insights = (() => {
    if (ragLoading) return [];
    if (ragError || ragEmpty || !ragCards?.length) return defaultInsights;
    return ragCards.slice(0, 3).map((c, idx) => ({
      id: c.id || `${c.type}-${idx}`,
      label: c.label,
      summary: c.summary,
      nextStep: c.nextStep
    }));
  })();

  useEffect(() => {
    if (!activeInsightId && insights.length) setActiveInsightId(insights[0].id);
  }, [activeInsightId, insights]);

  const activeInsight = insights.find((i) => i.id === activeInsightId) || insights[0] || null;

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
  }, [catalogFilterId, products.length]);

  const scrollSolutionsBy = (direction) => {
    const el = solutionsViewportRef.current;
    if (!el) return;
    const cards = el.querySelectorAll('.solution-card');
    const first = cards[0];
    const second = cards[1];
    const gap =
      first && second ? second.offsetLeft - first.offsetLeft - first.offsetWidth : 22;
    const stride = first ? first.getBoundingClientRect().width + gap : el.clientWidth;
    el.scrollBy({ left: stride * direction, behavior: 'smooth' });
  };

  return (
    <main className="page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="top-nav">
        <a href="/" className="brand-mark">Skin &amp; Care</a>
        <nav aria-label="Main navigation" className="nav-links">
          <a href="#products">Products</a>
          <a href="#scan-results">Skin Diagnosis</a>
          <a href="#before-after">New</a>
          <a href="#patient-reviews">Bestsellers</a>
        </nav>
        <div className="nav-actions">
          <a className="btn-primary nav-start-btn" href="/unified-dashboard/patients/patient-login.html" onClick={handleStartAnalysis}>
            Start Analysis
          </a>
          <button
            type="button"
            className="mobile-menu-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={showMobileMenu}
            onClick={() => setShowMobileMenu((v) => !v)}
          >
            {showMobileMenu ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>
      {showMobileMenu && (
        <div className="mobile-menu-panel" role="dialog" aria-label="Mobile navigation menu">
          <a href="#products" onClick={() => setShowMobileMenu(false)}>Products</a>
          <a href="#scan-results" onClick={() => setShowMobileMenu(false)}>Skin Diagnosis</a>
          <a href="#before-after" onClick={() => setShowMobileMenu(false)}>New</a>
          <a href="#patient-reviews" onClick={() => setShowMobileMenu(false)}>Bestsellers</a>
        </div>
      )}

      <section id="main-content" className="hero">
        <p className="kicker">
          <img className="kicker-icon" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
          <span>LOVE YOUR SKIN</span>
        </p>
        <h1>
          AI-Powered Skin Scan
          <br />
          Instant Results
        </h1>
        <p className="subtext">
          Discover personalized skincare insights in seconds with Skin &amp; Care.
          Private-first analysis. Tailored routines. Better daily outcomes.
        </p>
        <div className="hero-ctas">
          <a className="btn-primary" href="/unified-dashboard/patients/patient-login.html" onClick={handleStartAnalysis}>
            Start Analysis
          </a>
          <a className="btn-ghost" href="#demo" onClick={handleWatchDemo}>
            Watch Demo
          </a>
        </div>

        <div id="demo" className="scan-stage" aria-label="Skin scan preview">
          <img
            src="/images/hero/form-10-hero.png"
            alt="Skin and Care face scan analysis preview"
            className="hero-image-full"
          />
        </div>
      </section>

      <section className="routine-band" aria-label="Discover your skincare routine">
        <h2 className="routine-title">
          <span className="routine-title-strong">Reveal the best skin</span>{' '}
          <span className="routine-title-soft">routine made uniquely for you.</span>
        </h2>
        <img
          src="/images/products/routine-bottle.png"
          alt="Skin and Care Vitamin C serum bottle"
          className={`routine-bottle ${isDraggingBottle ? 'is-dragging' : ''}`}
          style={{
            '--bottle-x': `${bottleOffset.x}px`,
            '--bottle-y': `${bottleOffset.y}px`
          }}
          onPointerDown={handleBottlePointerDown}
          onPointerMove={handleBottlePointerMove}
          onPointerUp={endBottleDrag}
          onPointerCancel={endBottleDrag}
        />
      </section>

      <section className="solutions" aria-label="Our skincare solutions" id="products">
        <p className="solutions-kicker">
          <img className="pill-panda" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
          <span>MOST POPULAR PRODUCT</span>
        </p>
        <h2>Our Skincare Solutions</h2>

        <div className="solutions-shell">
          <div className="solutions-controls">
            <p className="solutions-browse-copy">Browse by serum</p>
            <div className="solutions-controls-right" role="tablist" aria-label="Filter by product">
              {CATALOG_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={catalogFilterId === f.id}
                  className={`solutions-tab ${catalogFilterId === f.id ? 'active' : ''}`}
                  onClick={() => setCatalogFilterId(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {CHAT_FIRST_CHECKOUT ? (
            <p className="solutions-ask-buy-legend" role="note">
              <strong>Ask</strong> chat with Kelly first. <strong>Buy</strong> uses the bag icon for secure checkout.
            </p>
          ) : null}

          <div className="solutions-carousel">
            <button
              type="button"
              className="solutions-nav prev"
              aria-label="Previous products"
              onClick={() => scrollSolutionsBy(-1)}
              disabled={solutionsNav.atStart}
            >
              ‹
            </button>

            <div
              className="solutions-viewport"
              aria-label="Skincare product carousel"
              ref={solutionsViewportRef}
              onScroll={updateSolutionsNav}
            >
              <div
                className={`solutions-track${catalogFilterId !== 'all' ? ' solutions-track--focused' : ''}`}
              >
                {filteredProductCards.map((product) => (
                  <article
                    key={product.id}
                    className={`solution-card ${product.featured ? 'featured' : ''}`}
                    aria-label={product.displayName}
                  >
                    <div className="solution-media">
                      <img src={product.image} alt={product.displayName} />
                      <button
                        type="button"
                        className="solution-checkout-icon"
                        onClick={() => handleStartProductCheckout(product)}
                        disabled={checkoutBusyProductId === product.id}
                        aria-label={`Buy now — ${product.displayName}`}
                        title={checkoutBusyProductId === product.id ? 'Starting checkout…' : 'Buy now (secure checkout)'}
                      >
                        {checkoutBusyProductId === product.id ? (
                          <span aria-hidden="true">…</span>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                            <path d="M3 6h18" />
                            <path d="M16 10a4 4 0 0 1-8 0" />
                          </svg>
                        )}
                      </button>
                      <p className="solution-media-title">{product.displayName}</p>
                    </div>
                    <div className="solution-meta">
                      <p className="solution-ask-wrap">
                        {CHAT_FIRST_CHECKOUT ? (
                          <a
                            className={`solution-ask-link${askBusyProductId === product.id ? ' is-busy' : ''}`}
                            href={buildAskAboutProductUrl(product)}
                            aria-busy={askBusyProductId === product.id}
                            onClick={(e) => {
                              e.preventDefault();
                              if (askBusyProductId) return;
                              emitCheckoutFunnelEvent('landing_cta_chat', { product_id: product.id, source: 'landing' });
                              setAskBusyProductId(product.id);
                              const dest = buildAskAboutProductUrl(product);
                              window.requestAnimationFrame(() => {
                                window.location.assign(dest);
                              });
                            }}
                          >
                            {askBusyProductId === product.id ? 'Opening…' : 'Ask about this product'}
                          </a>
                        ) : (
                          <span className="solution-ask-legacy" style={{ fontSize: '0.85rem', color: '#64748b' }}>
                            Shop checkout: use the bag icon. Chat-first handoff is disabled for this build.
                          </span>
                        )}
                      </p>
                      <div className="solution-product-badges" aria-label="Product tags">
                        {product.colorBadges.category ? (
                          <span className="solution-cat-pill">{product.colorBadges.category}</span>
                        ) : null}
                        {product.colorBadges.protocol ? (
                          <span className="solution-protocol-pill">{product.colorBadges.protocol}</span>
                        ) : null}
                        {product.colorBadges.highlight ? (
                          <span className="solution-label-pill">{product.colorBadges.highlight}</span>
                        ) : null}
                      </div>
                      <div className="solution-row solution-row-title">
                        <h3>{product.displayName}</h3>
                        <p className="solution-size">{product.size}</p>
                      </div>
                      {product.shortDescription ? (
                        <p className="solution-blurb">{product.shortDescription}</p>
                      ) : null}
                      <div className="solution-row">
                        <p className="solution-price-line">{product.price || '$0.00'}</p>
                        <p className="solution-stars">★★★★★</p>
                      </div>
                      <div className="solution-row solution-row-rating">
                        <p>{product.rating}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="solutions-nav next"
              aria-label="Next products"
              onClick={() => scrollSolutionsBy(1)}
              disabled={solutionsNav.atEnd}
            >
              ›
            </button>
          </div>
          {!productsLoading && productsError && (
            <p className="solutions-browse-copy" role="status">
              Product catalog unavailable ({productsError}). Showing fallback until API is reachable.
            </p>
          )}
        </div>
      </section>

      <section className="scan-results" aria-label="Scan your face and get result" id="scan-results">
        <div className="scan-results-intro">
          <p className="scan-results-badge">
            <img className="scan-badge-icon" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
            <span>AI SCAN</span>
          </p>
          <h2 className="scan-results-title">Scan Your Face &amp; Get Result</h2>
          <p className="scan-results-sub">Live analysis, product guidance, and next steps — in one flow.</p>
        </div>

        <div className="scan-results-grid">
          <aside className="scan-results-left" aria-label="Skin insights">
            {ragLoading ? (
              <div className="scan-skeleton-stack" aria-hidden="true">
                <div className="scan-skel" />
                <div className="scan-skel" />
                <div className="scan-skel" />
              </div>
            ) : (
              insights.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`scan-insight ${item.id === activeInsightId ? 'active' : ''}`}
                  onClick={() => setActiveInsightId(item.id)}
                >
                  <div className="scan-insight-pill">
                    <span className="scan-insight-dot" aria-hidden="true" />
                    <span className="scan-insight-label">{item.label}</span>
                  </div>
                  <p className="scan-insight-text">{item.summary}</p>
                </button>
              ))
            )}

            <div className="scan-card scan-assistant-card" aria-label="Assistant recommendation">
              <div className="scan-card-badge" aria-hidden="true">AI</div>
              <p className="scan-card-title">Thank you for the photo!</p>
              <p className="scan-card-subtitle">
                While I analyze your skin, here’s a product that pairs well with your routine right now.
              </p>
              <div className="scan-assistant-product">
                <img src="/images/products/routine-bottle.png" alt="Vitamin C serum recommendation" />
                <div>
                  <p className="scan-assistant-name">Vitamin C Serum</p>
                  <p className="scan-assistant-note">
                    Brightens uneven tone and supports a more even-looking glow.
                  </p>
                </div>
              </div>
              {ragError ? <div className="scan-query-note">{ragError}</div> : null}
            </div>
          </aside>

          <div className="scan-results-center" aria-label="Scan preview">
            <div className="scan-phone">
              <img src="/images/sections/scan-middle-face.png" alt="Scan preview" className="scan-phone-img" />
              <div className="scan-cv-overlay" aria-hidden="true">
                <div className="scan-cv-top">
                  <span className="scan-cv-tag">AI</span>
                  <span className="scan-cv-status">Face detected • Live CV</span>
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
              <button className="scan-primary-btn" type="button" onClick={handleStartAnalysis}>
                Try now
              </button>
            </div>
          </div>

          <aside className="scan-results-right" aria-label="Dermatology FAQs">
            <div className="scan-faq-header" aria-hidden="true">
              <img className="pill-panda" src="/images/branding/logo-panda.png" alt="" aria-hidden="true" />
              <span>MEDICAL DERMATOLOGY</span>
            </div>
            <h3 className="scan-faq-title">Science-backed care for all skin conditions</h3>
            <div className="scan-faq" aria-label="Frequently asked questions">
              <details className="faq-item" open>
                <summary>
                  What does the AI skin scan analyze?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  It looks for common skin signals like acne, tone and texture concerns, visible irritation, and early
                  signs of uneven pigmentation—then translates them into a simple routine and next steps.
                </p>
              </details>

              <details className="faq-item">
                <summary>
                  Is this a medical diagnosis?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  No. The scan provides guidance and education, not a diagnosis. If we detect signs that need clinical
                  review, we’ll guide you into a dermatologist consult through the patient portal.
                </p>
              </details>

              <details className="faq-item">
                <summary>
                  Do you store my photo or scan results?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  Your scan is used to generate results and recommendations. We minimize retention and keep access limited
                  to your care experience in the patient portal.
                </p>
              </details>

              <details className="faq-item">
                <summary>
                  How accurate is the scan?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  Accuracy depends on lighting and image quality. We show results with clear next steps, and you can always
                  confirm with a clinician—especially for persistent, painful, or rapidly changing concerns.
                </p>
              </details>

              <details className="faq-item">
                <summary>
                  What happens after I get results?
                  <span className="faq-control" aria-hidden="true" />
                </summary>
                <p>
                  You’ll get a recommended routine and product guidance. If you want, you can continue into the patient
                  portal to ask questions, share more context, and get clinician-backed next steps.
                </p>
              </details>
            </div>
          </aside>
        </div>
      </section>

      <section className="patient-reviews" aria-label="What our patients say" id="patient-reviews">
        <div className="patient-reviews-grid">
          <div className="patient-reviews-copy">
            <h2>What our patients say</h2>
            <div className="reviews-nav" aria-hidden="true">
              <button type="button">←</button>
              <button type="button">→</button>
            </div>
          </div>

          <div className="reviews-track-wrap" aria-label="Auto-moving testimonials">
            <div className="reviews-track">
              <article className="review-mini-card">
                <div className="review-mini-stars">★★★★★</div>
                <p>
                  The personalized approach made all the difference. They didn’t rush anything and created a plan that
                  worked for my skin.
                </p>
                <div className="review-mini-author">
                  <span className="avatar a2" aria-hidden="true" />
                  <div>
                    <strong>Olivia Chen</strong>
                    <small>Creative Director</small>
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
                    <small>Actress</small>
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
                    <small>Product Manager</small>
                  </div>
                </div>
              </article>

              <article className="review-mini-card">
                <div className="review-mini-stars">★★★★★</div>
                <p>
                  The personalized approach made all the difference. They didn’t rush anything and created a plan that
                  worked for my skin.
                </p>
                <div className="review-mini-author">
                  <span className="avatar a2" aria-hidden="true" />
                  <div>
                    <strong>Olivia Chen</strong>
                    <small>Creative Director</small>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <aside className="reviews-score-card">
            <img src="/images/hero/patient-rating-hero.png" alt="Patient result close-up" />
            <div className="reviews-score-overlay">
              <div className="score-number">4.9</div>
              <div className="review-mini-stars">★★★★★</div>
              <div className="score-label">CLIENTS RATING</div>
            </div>
          </aside>
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

          <aside className="before-after-right" aria-label="Suggested products">
            <div className="ba-spotlight" aria-label="Vitamin C serum spotlight">
              <p className="ba-spotlight-kicker">Vitamin C Serum</p>
              <div className="ba-spotlight-stage" aria-label="Move the bottle">
                <img
                  className={`ba-spotlight-bottle ${isDraggingBaBottle ? 'is-dragging' : ''}`}
                  src="/images/products/routine-bottle.png"
                  alt="Vitamin C Serum bottle"
                  style={{
                    '--ba-bottle-x': `${baBottleOffset.x}px`,
                    '--ba-bottle-y': `${baBottleOffset.y}px`
                  }}
                  onPointerDown={handleBaBottlePointerDown}
                  onPointerMove={handleBaBottlePointerMove}
                  onPointerUp={endBaBottleDrag}
                  onPointerCancel={endBaBottleDrag}
                />
              </div>
              <a
                className="ba-buy"
                href="/unified-dashboard/patients/patient-login.html"
                onClick={handleStartAnalysis}
              >
                Buy Vitamin C Serum <span aria-hidden="true">→</span>
              </a>
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
            href="/unified-dashboard/patients/patient-login.html"
            onClick={handleStartAnalysis}
            aria-label="Open patient portal for general inquiries"
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
                  <h2>Dermatology care that feels personal.</h2>
                  <p>
                    Scan your face, understand your skin, and get a routine built with dermatologists, not just algorithms.
                  </p>
                  <div className="site-footer-ctas">
                    <a
                      className="btn-primary"
                      href="/unified-dashboard/patients/patient-login.html"
                      onClick={handleStartAnalysis}
                    >
                      Start Analysis
                    </a>
                    <a className="btn-ghost" href="#products">
                      Browse products
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="site-footer-bottom">
              <div className="site-footer-brand">
                <img src="/images/branding/logo-panda.png" alt="Skin &amp; Care logo" />
                <span>Skin &amp; Care</span>
              </div>
              <nav className="site-footer-links" aria-label="Footer navigation">
                <a href="#products">Products</a>
                <a href="#scan-results">Scan results</a>
                <a href="/unified-dashboard/patients/patient-login.html">Patient portal</a>
                <a href="#contact">Contact</a>
              </nav>
              <p className="site-footer-meta">
                © {new Date().getFullYear()} Skin &amp; Care. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>

      {showDemoModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Demo video">
          <div className="modal-panel">
            <button className="modal-close" onClick={() => setShowDemoModal(false)} aria-label="Close demo">
              ×
            </button>
            <h3>Skin &amp; Care Demo</h3>
            <video className="modal-video" poster="/images/hero/form-10-hero.png" controls autoPlay playsInline>
              <source src="/videos/skin-care-demo.mp4" type="video/mp4" />
            </video>
            <p className="modal-note">
              Place your production video at <code>/public/videos/skin-care-demo.mp4</code> to replace this placeholder.
            </p>
          </div>
        </div>
      )}

      {showPortalModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose portal">
          <div className="modal-panel">
            <button className="modal-close" onClick={() => setShowPortalModal(false)} aria-label="Close portal selector">
              ×
            </button>
            <h3>Continue to analysis</h3>
            <p className="modal-note">Choose where you want to continue.</p>
            <div className="portal-actions">
              <a className="btn-primary" href="/unified-dashboard/patients/patient-login.html">Patient Portal</a>
              <a className="btn-ghost" href="/unified-dashboard/login.html">Provider Portal</a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<Root />);

