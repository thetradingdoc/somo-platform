/**
 * PRODUCTS ROUTES
 * Product management endpoints (merged from merchant-shop)
 * All routes require customer authentication and are scoped to customer's merchant
 */

const express = require('express');
const db = require('../database');
const { requireCustomerAuth, requireMerchant } = require('../middleware/customer-auth');
const {
  resolvePrescriptionId,
  withProviderAliases,
  withPrescriptionAliases,
  mapProductToPrescription,
  mapProductsToPrescriptions,
  logAliasUsage
} = require('../utils/naming-aliases');
const router = express.Router();

/**
 * Get all products
 * GET /api/products
 * Returns products scoped to authenticated customer's merchant
 */
router.get('/', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    logAliasUsage('products-list', req);
    // Scope to customer's merchant_id (from auth middleware)
    const merchant_id = req.merchant_id;
    const products = db.getProductsByMerchant(merchant_id);
    
    res.json(withProviderAliases({
      success: true, 
      products,
      prescriptions: mapProductsToPrescriptions(products),
      merchant_id,
      count: products.length
    }, merchant_id));
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get single product
 * GET /api/products/:id
 * Returns product only if it belongs to customer's merchant
 */
router.get('/:id', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    const lookupId = resolvePrescriptionId({ prescription_id: req.params.id, product_id: req.params.id });
    const product = db.getProduct(lookupId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    
    // Verify product belongs to customer's merchant
    if (product.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This product does not belong to your merchant account.'
      });
    }
    
    res.json(withProviderAliases({
      success: true,
      product,
      prescription: mapProductToPrescription(product)
    }, req.merchant_id));
  } catch (error) {
    console.error('❌ Error fetching product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Search products
 * GET /api/products/search?q=query
 * Searches products scoped to customer's merchant
 */
router.get('/search', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    logAliasUsage('products-search', req);
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, error: 'Search query required' });
    }
    
    // Scope search to customer's merchant_id
    const merchant_id = req.merchant_id;
    const products = db.searchProducts(q, merchant_id);
    res.json(withProviderAliases({
      success: true, 
      products, 
      prescriptions: mapProductsToPrescriptions(products),
      count: products.length,
      merchant_id,
      query: q
    }, merchant_id));
  } catch (error) {
    console.error('❌ Error searching products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Create product
 * POST /api/products
 * Creates product for customer's merchant (merchant_id from auth)
 */
router.post('/', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    logAliasUsage('products-create', req);
    const body = req.body || {};
    const name = body.name || body.prescription_name;
    const { description, price, inventory, image_url, category } = body;
    
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: 'Name and price are required' });
    }

    // Use merchant_id from authenticated customer (not from request body)
    const merchant_id = req.merchant_id;

    const result = db.createProduct({
      name,
      description,
      price,
      inventory: inventory !== undefined ? inventory : 0,
      image_url,
      category,
      merchant_id // Set from auth, ignore if provided in body
    });

    const product = db.getProduct(result.lastInsertRowid.toString());
    res.status(201).json(withProviderAliases({
      success: true,
      product,
      prescription: mapProductToPrescription(product)
    }, merchant_id));
  } catch (error) {
    console.error('❌ Error creating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Update product
 * PUT /api/products/:id
 * Updates product only if it belongs to customer's merchant
 */
router.put('/:id', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    logAliasUsage('products-update', req);
    const lookupId = resolvePrescriptionId({ prescription_id: req.params.id, product_id: req.params.id });
    const product = db.getProduct(lookupId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Verify product belongs to customer's merchant
    if (product.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This product does not belong to your merchant account.'
      });
    }

    // Remove merchant_id from update body (cannot change merchant)
    const { merchant_id, provider_id, prescription_name, ...updateData } = req.body || {};
    if (prescription_name && !updateData.name) updateData.name = prescription_name;

    const result = db.updateProduct(lookupId, updateData);
    if (result.changes === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    const updatedProduct = db.getProduct(lookupId);
    res.json(withProviderAliases({
      success: true,
      product: updatedProduct,
      prescription: mapProductToPrescription(updatedProduct)
    }, req.merchant_id));
  } catch (error) {
    console.error('❌ Error updating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete product
 * DELETE /api/products/:id
 * Deletes product only if it belongs to customer's merchant
 */
router.delete('/:id', requireCustomerAuth, requireMerchant, (req, res) => {
  try {
    logAliasUsage('products-delete', req);
    const lookupId = resolvePrescriptionId({ prescription_id: req.params.id, product_id: req.params.id });
    const product = db.getProduct(lookupId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Verify product belongs to customer's merchant
    if (product.merchant_id !== req.merchant_id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied',
        message: 'This product does not belong to your merchant account.'
      });
    }

    db.deleteProduct(lookupId);
    res.json(withProviderAliases(withPrescriptionAliases({
      success: true,
      message: 'Product deleted'
    }, lookupId), req.merchant_id));
  } catch (error) {
    console.error('❌ Error deleting product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

