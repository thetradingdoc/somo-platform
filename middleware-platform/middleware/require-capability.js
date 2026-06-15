'use strict';

const db = require('../database');
const { hasCapability } = require('../services/customer-capabilities');

function requireCapability(capability) {
  return (req, res, next) => {
    const customer = req.customer;
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!hasCapability(customer, capability)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Missing capability: ${capability}`
      });
    }
    return next();
  };
}

function requireCapabilityOrAdmin(capability) {
  return (req, res, next) => {
    if (req.adminAuthenticated) return next();
    const customer = req.customer;
    if (customer && hasCapability(customer, capability)) return next();
    return res.status(403).json({ success: false, error: 'Forbidden' });
  };
}

module.exports = { requireCapability, requireCapabilityOrAdmin };
