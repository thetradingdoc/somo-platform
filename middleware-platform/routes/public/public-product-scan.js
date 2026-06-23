'use strict';

const Metrics = require('../../services/shared/metrics');
const IngredientEnrichmentService = require('../../services/catalog/ingredient-enrichment-service');

function registerPublicProductScanRoutes(app, deps) {
  const { apiLimiter } = deps;

app.get('/api/public/beautyfacts/:barcode', apiLimiter, async (req, res) => {
  try {
    const includeScanSummary = String(process.env.SCAN_SUMMARY_V1 || '1').trim() !== '0';
    const {
      buildScanQuality,
      deriveIngredientFlags,
      buildCategoryRoutePayload
    } = require('../../services/shared/scan-route-response');
    const { buildScanSummary } = require('../../services/catalog/product-summary-service');
    const { resolveCategoryRoute } = require('../../services/catalog/category-route-resolver');
    const { rolloutConfig, shouldUseCanary } = require('../../services/platform/category-route-rollout');
    const deriveCategoryRoute = (product = {}, barcode = '') => {
      const cfg = rolloutConfig();
      const primary = resolveCategoryRoute({
        source: 'open_beauty_facts',
        categories_tags: product.categories_tags || [],
        categories_hierarchy: product.categories_hierarchy || [],
        product_name: product.product_name || '',
        brands: product.brands || [],
        ingredients_text: product.ingredients_text || ''
      });
      let shadow = null;
      if (cfg.shadowMapFile) {
        shadow = resolveCategoryRoute({
          source: 'open_beauty_facts',
          categories_tags: product.categories_tags || [],
          categories_hierarchy: product.categories_hierarchy || [],
          product_name: product.product_name || '',
          brands: product.brands || [],
          ingredients_text: product.ingredients_text || '',
          mapFile: cfg.shadowMapFile
        });
      }
      const canaryOn = shadow && cfg.mode !== 'shadow_only' && shouldUseCanary(barcode || product.barcode || '', cfg.canaryPercent);
      const active = cfg.mode === 'shadow_only' && shadow ? shadow : canaryOn ? shadow : primary;
      return { active, primary, shadow, canary_applied: !!canaryOn, rollout_mode: cfg.mode };
    };
    const { fetchBeautyFactsByBarcode } = require('../../services/catalog/open-beauty-facts-service');
    const db = require('./database');
    const barcode = String(req.params?.barcode || '').trim();
    try {
      console.log(`[beautyfacts] lookup barcode=${barcode} request_id=${req.id || ''}`);
    } catch (_) {}
    if (String(req.query?.simulate || '').trim() === 'timeout') {
      return res.status(502).json({
        success: false,
        error: 'upstream_timeout',
        barcode,
        recovery: { type: 'retry', message: 'Network is slow right now. Please retry, or add ingredients manually.' },
        request_id: req.id
      });
    }
    const disableCacheRead = String(req.query?.cache || '').trim() === '0' || String(req.query?.force_live || '').trim() === '1';
    const cached = db.getObfIndexProductByCode(barcode);
    let out = null;
    let dataSource = 'live_api';
    if (!disableCacheRead && cached && String(process.env.OBF_INDEX_CACHE_READ || '1') !== '0') {
      out = {
        success: true,
        normalized: {
          source: 'open_beauty_facts',
          barcode: cached.code,
          found: true,
          product_name: cached.product_name || null,
          brands: String(cached.brands || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          ingredients_text: cached.ingredients_text || null,
          ingredients: [],
          allergens: [],
          labels: [],
          categories: [],
          categories_tags: Array.isArray(cached.categories_tags) ? cached.categories_tags : [],
          categories_hierarchy: Array.isArray(cached.categories_hierarchy) ? cached.categories_hierarchy : [],
          ingredients_analysis_tags: Array.isArray(cached.ingredients_analysis_tags) ? cached.ingredients_analysis_tags : [],
          states_tags: Array.isArray(cached.states_tags) ? cached.states_tags : [],
          product_type: null,
          image_url: cached.image_url || null,
          product_url: cached.product_url || null
        }
      };
      dataSource = 'obf_index_cache';
      try { Metrics.increment('obf.index_cache.hit.count', 1); } catch (_) {}
    } else {
      try { Metrics.increment('obf.index_cache.miss.count', 1); } catch (_) {}
      out = await fetchBeautyFactsByBarcode(barcode);
      if (out?.success) {
        try { Metrics.increment('obf.index_cache.fallback_to_live.count', 1); } catch (_) {}
      }
    }
    if (!out.success) {
      const status = out.error === 'invalid_barcode' ? 400 : 502;
      const isTimeout = out.error === 'upstream_timeout' || out.error === 'upstream_unreachable';
      const isUpstreamFail =
        isTimeout ||
        String(out.error || '').startsWith('upstream_') ||
        out.error === 'upstream_unreachable';
      return res.status(status).json({
        success: false,
        error: out.error,
        barcode,
        recovery: out.error === 'invalid_barcode'
          ? { type: 'manual_barcode_entry', message: 'Enter a valid 8-14 digit barcode.' }
          : isTimeout
            ? { type: 'retry', message: 'Network is slow right now. Please retry, or add ingredients manually.' }
            : isUpstreamFail
              ? {
                  type: 'ingredient_scan_or_manual',
                  message:
                    'Product database is slow or unavailable. Hold the label for a scan, type ingredients, or retry the barcode shortly.'
                }
              : { type: 'retry', message: 'Lookup failed. Try again, or add ingredients manually.' },
        request_id: req.id
      });
    }
    if (out.normalized && out.normalized.found === false) {
      return res.status(404).json({
        success: false,
        error: 'upstream_404',
        barcode: out.normalized?.barcode || barcode,
        data_source: dataSource,
        recovery: {
          type: 'manual_ingredients',
          message: 'Product not found. Add ingredient list for analysis.'
        },
        request_id: req.id
      });
    }
    let persisted = null;
    if (String(process.env.PRODUCT_TAXONOMY_PERSIST_PUBLIC_LOOKUP || '').trim() === '1') {
      try {
        const repo = require('../../services/catalog/product-taxonomy-repository');
        const full = String(process.env.PRODUCT_TAXONOMY_FULL_ENRICH || '').trim() === '1';
        const saved = full
          ? await repo.upsertProductTaxonomyFullPipeline(out.normalized)
          : repo.upsertFromBeautyFacts(out.normalized);
        if (saved?.ok) {
          repo.logBarcodeLookup({
            barcode: out.normalized?.barcode || barcode,
            source: 'open_beauty_facts',
            hit: true,
            productId: saved.product_id,
            gradeClass: saved?.grade?.grade_class,
            confidence: saved?.grade?.confidence,
            details: { product_name: out.normalized?.product_name, public_api: true, full_enrich: full }
          });
          persisted = { product_id: saved.product_id, grade: saved.grade };
        }
      } catch (persistErr) {
        console.warn('[beautyfacts] taxonomy persist skipped:', persistErr?.message || persistErr);
      }
    }
    const scanQuality = buildScanQuality(out.normalized || {});
    const categoryEval = deriveCategoryRoute(out.normalized || {}, out.normalized?.barcode || barcode);
    const ingredientFlags = deriveIngredientFlags(out.normalized || {});
    const scanSummary = buildScanSummary({
      product: out.normalized || {},
      categoryRoute: categoryEval?.active?.route || 'unknown',
      categoryRouteSource: categoryEval?.active?.source || null,
      categoryRouteRuleId: categoryEval?.active?.rule_id || null,
      catalogSource: out?.normalized?.source || 'open_beauty_facts'
    });
    const enrichmentProductId = `obf:${out.normalized?.barcode || barcode}`;
    const ingredientsEnriched = IngredientEnrichmentService.getEnrichedIngredients(enrichmentProductId);
    const ingredientSummary = IngredientEnrichmentService.deriveIngredientSummary(ingredientsEnriched);
    const lowConfidence = (() => {
      const total = Number(ingredientSummary?.total_ingredients || 0);
      const unresolved = Number(ingredientSummary?.confidence_distribution?.low_or_unresolved || 0);
      return total > 0 && (unresolved / total) > 0.3;
    })();
    const groundingMetadata = {
      enrichment_version:
        ingredientsEnriched.find((i) => i && i.enrichment_version)?.enrichment_version || null,
      source_fields: [
        'products_obf_index.ingredients_text',
        'products_obf_index.ingredients_tags_json',
        'products_obf_index.ingredients_analysis_tags_json',
        'product_ingredients',
        'cosing_ingredients'
      ],
      confidence_distribution: ingredientSummary?.confidence_distribution || {},
      low_confidence: lowConfidence,
      fallback_mode: lowConfidence ? 'ask_for_label_or_manual_ingredients' : 'structured_enrichment'
    };
    try {
      const tileEntries = Object.entries(scanSummary?.tiles || {});
      tileEntries.forEach(([tile, data]) => {
        const status = String(data?.status || 'unknown');
        Metrics.increment(`scan_summary.tile.${tile}.${status}.count`, 1);
        if (status === 'available') Metrics.increment(`scan_summary.tile_available_rate.${tile}.hit`, 1);
        Metrics.increment(`scan_summary.tile_available_rate.${tile}.total`, 1);
        if (data?.reason_unavailable) {
          Metrics.increment(`scan_summary.tile_reason.${tile}.${String(data.reason_unavailable)}.count`, 1);
        }
      });
    } catch (_) {}
    return res.json({
      success: true,
      barcode: out.normalized?.barcode || barcode,
      product: out.normalized,
      scan_quality: scanQuality,
      cta_state: {
        analyze_enabled: scanQuality.analyze_enabled,
        analyze_label: scanQuality.analyze_label
      },
      ...buildCategoryRoutePayload(categoryEval),
      ...(includeScanSummary ? { scan_summary: scanSummary } : {}),
      ingredient_flags: ingredientFlags,
      ingredients_enriched: ingredientsEnriched,
      ingredient_summary: ingredientSummary,
      grounding_metadata: groundingMetadata,
      sparse_data: scanQuality.missing.includes('ingredients') || scanQuality.missing.includes('categories'),
      data_source: dataSource,
      ...(persisted ? { taxonomy: persisted } : {}),
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'internal_error', request_id: req.id });
  }
});

app.get('/api/public/foodfacts/:barcode', apiLimiter, async (req, res) => {
  try {
    const includeScanSummary = String(process.env.SCAN_SUMMARY_V1 || '1').trim() !== '0';
    const {
      buildScanQuality,
      deriveIngredientFlags,
      buildCategoryRoutePayload
    } = require('../../services/shared/scan-route-response');
    const { buildScanSummary } = require('../../services/catalog/product-summary-service');
    const { resolveCategoryRoute } = require('../../services/catalog/category-route-resolver');
    const { rolloutConfig, shouldUseCanary } = require('../../services/platform/category-route-rollout');
    const deriveCategoryRoute = (product = {}, barcode = '') => {
      const cfg = rolloutConfig();
      const primary = resolveCategoryRoute({
        source: 'open_food_facts',
        categories_tags: product.categories_tags || [],
        categories_hierarchy: product.categories_hierarchy || [],
        product_name: product.product_name || '',
        brands: product.brands || [],
        ingredients_text: product.ingredients_text || ''
      });
      let shadow = null;
      if (cfg.shadowMapFile) {
        shadow = resolveCategoryRoute({
          source: 'open_food_facts',
          categories_tags: product.categories_tags || [],
          categories_hierarchy: product.categories_hierarchy || [],
          product_name: product.product_name || '',
          brands: product.brands || [],
          ingredients_text: product.ingredients_text || '',
          mapFile: cfg.shadowMapFile
        });
      }
      const canaryOn = shadow && cfg.mode !== 'shadow_only' && shouldUseCanary(barcode || product.barcode || '', cfg.canaryPercent);
      const active = cfg.mode === 'shadow_only' && shadow ? shadow : canaryOn ? shadow : primary;
      return { active, primary, shadow, canary_applied: !!canaryOn, rollout_mode: cfg.mode };
    };
    const { fetchFoodFactsByBarcode, ingredientsTextFromTags } = require('../../services/platform/open-food-facts-service');
    const db = require('./database');
    const barcode = String(req.params?.barcode || '').trim();
    try {
      console.log(`[foodfacts] lookup barcode=${barcode} request_id=${req.id || ''}`);
    } catch (_) {}
    if (String(req.query?.simulate || '').trim() === 'timeout') {
      return res.status(502).json({
        success: false,
        error: 'upstream_timeout',
        barcode,
        recovery: { type: 'retry', message: 'Network is slow right now. Please retry, or add ingredients manually.' },
        request_id: req.id
      });
    }
    const disableCacheRead = String(req.query?.cache || '').trim() === '0' || String(req.query?.force_live || '').trim() === '1';
    const cached = db.getOffIndexProductByCode(barcode);
    let out = null;
    let dataSource = 'live_api';
    if (!disableCacheRead && cached && String(process.env.OFF_INDEX_CACHE_READ || '1') !== '0') {
      out = {
        success: true,
        normalized: {
          source: 'open_food_facts',
          barcode: cached.code,
          found: true,
          product_name: cached.product_name || null,
          brands: String(cached.brands || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          ingredients_text:
            (cached.ingredients_text && String(cached.ingredients_text).trim()) ||
            ingredientsTextFromTags(cached.ingredients_tags) ||
            null,
          ingredients: [],
          allergens: [],
          labels: [],
          categories: [],
          categories_tags: Array.isArray(cached.categories_tags) ? cached.categories_tags : [],
          categories_hierarchy: Array.isArray(cached.categories_hierarchy) ? cached.categories_hierarchy : [],
          ingredients_analysis_tags: Array.isArray(cached.ingredients_analysis_tags) ? cached.ingredients_analysis_tags : [],
          states_tags: Array.isArray(cached.states_tags) ? cached.states_tags : [],
          product_type: null,
          image_url: cached.image_url || null,
          product_url: cached.product_url || null
        }
      };
      dataSource = 'off_index_cache';
      try { Metrics.increment('off.index_cache.hit.count', 1); } catch (_) {}
    } else {
      try { Metrics.increment('off.index_cache.miss.count', 1); } catch (_) {}
      out = await fetchFoodFactsByBarcode(barcode);
      if (out?.success) {
        try { Metrics.increment('off.index_cache.fallback_to_live.count', 1); } catch (_) {}
      }
    }
    if (!out.success) {
      const status = out.error === 'invalid_barcode' ? 400 : 502;
      const isTimeout = out.error === 'upstream_timeout' || out.error === 'upstream_unreachable';
      return res.status(status).json({
        success: false,
        error: out.error,
        barcode,
        recovery: out.error === 'invalid_barcode'
          ? { type: 'manual_barcode_entry', message: 'Enter a valid 8-14 digit barcode.' }
          : isTimeout
            ? { type: 'retry', message: 'Network is slow right now. Please retry, or add ingredients manually.' }
            : { type: 'retry', message: 'Lookup failed. Try again, or add ingredients manually.' },
        request_id: req.id
      });
    }
    if (out.normalized && out.normalized.found === false) {
      return res.status(404).json({
        success: false,
        error: 'upstream_404',
        barcode: out.normalized?.barcode || barcode,
        data_source: dataSource,
        recovery: {
          type: 'manual_ingredients',
          message: 'Product not found. Add ingredient list for analysis.'
        },
        request_id: req.id
      });
    }
    const scanQuality = buildScanQuality(out.normalized || {});
    const categoryEval = deriveCategoryRoute(out.normalized || {}, out.normalized?.barcode || barcode);
    const ingredientFlags = deriveIngredientFlags(out.normalized || {});
    const scanSummary = buildScanSummary({
      product: out.normalized || {},
      categoryRoute: categoryEval?.active?.route || 'unknown',
      categoryRouteSource: categoryEval?.active?.source || null,
      categoryRouteRuleId: categoryEval?.active?.rule_id || null,
      catalogSource: out?.normalized?.source || 'open_food_facts'
    });
    const enrichmentProductId = `off:${out.normalized?.barcode || barcode}`;
    const ingredientsEnriched = IngredientEnrichmentService.getEnrichedIngredients(enrichmentProductId);
    const ingredientSummary = IngredientEnrichmentService.deriveIngredientSummary(ingredientsEnriched);
    const lowConfidence = (() => {
      const total = Number(ingredientSummary?.total_ingredients || 0);
      const unresolved = Number(ingredientSummary?.confidence_distribution?.low_or_unresolved || 0);
      return total > 0 && (unresolved / total) > 0.3;
    })();
    const groundingMetadata = {
      enrichment_version:
        ingredientsEnriched.find((i) => i && i.enrichment_version)?.enrichment_version || null,
      source_fields: [
        'products_off_index.ingredients_text',
        'products_off_index.ingredients_tags_json',
        'products_off_index.ingredients_analysis_tags_json',
        'product_ingredients',
        'cosing_ingredients'
      ],
      confidence_distribution: ingredientSummary?.confidence_distribution || {},
      low_confidence: lowConfidence,
      fallback_mode: lowConfidence ? 'ask_for_label_or_manual_ingredients' : 'structured_enrichment'
    };
    try {
      const tileEntries = Object.entries(scanSummary?.tiles || {});
      tileEntries.forEach(([tile, data]) => {
        const status = String(data?.status || 'unknown');
        Metrics.increment(`scan_summary.tile.${tile}.${status}.count`, 1);
        if (status === 'available') Metrics.increment(`scan_summary.tile_available_rate.${tile}.hit`, 1);
        Metrics.increment(`scan_summary.tile_available_rate.${tile}.total`, 1);
        if (data?.reason_unavailable) {
          Metrics.increment(`scan_summary.tile_reason.${tile}.${String(data.reason_unavailable)}.count`, 1);
        }
      });
    } catch (_) {}
    return res.json({
      success: true,
      barcode: out.normalized?.barcode || barcode,
      product: out.normalized,
      scan_quality: scanQuality,
      cta_state: {
        analyze_enabled: scanQuality.analyze_enabled,
        analyze_label: scanQuality.analyze_label
      },
      ...buildCategoryRoutePayload(categoryEval),
      ...(includeScanSummary ? { scan_summary: scanSummary } : {}),
      ingredient_flags: ingredientFlags,
      ingredients_enriched: ingredientsEnriched,
      ingredient_summary: ingredientSummary,
      grounding_metadata: groundingMetadata,
      sparse_data: scanQuality.missing.includes('ingredients') || scanQuality.missing.includes('categories'),
      data_source: dataSource,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'internal_error', request_id: req.id });
  }
});


}

module.exports = { registerPublicProductScanRoutes };
