/**
 * Input Validation Middleware
 * Validates and sanitizes request inputs for security
 */

const { validateEmail, validatePhone } = require('./security');

/**
 * Validate required fields in request body
 */
function validateRequired(fields) {
  return (req, res, next) => {
    const missing = [];
    
    for (const field of fields) {
      const value = req.body[field];
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    }
    
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing_fields: missing
      });
    }
    
    next();
  };
}

/**
 * Validate email format
 */
function validateEmailField(fieldName = 'email') {
  return (req, res, next) => {
    const email = req.body[fieldName];
    
    if (email && !validateEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
        field: fieldName
      });
    }
    
    next();
  };
}

/**
 * Validate phone number format
 */
function validatePhoneField(fieldName = 'phone') {
  return (req, res, next) => {
    const phone = req.body[fieldName];
    
    if (phone && !validatePhone(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        field: fieldName
      });
    }
    
    next();
  };
}

/**
 * Validate UUID format
 */
function validateUUID(fieldName = 'id') {
  return (req, res, next) => {
    const uuid = req.body[fieldName] || req.params[fieldName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (uuid && !uuidRegex.test(uuid)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid UUID format',
        field: fieldName
      });
    }
    
    next();
  };
}

/**
 * Validate numeric range
 */
function validateNumericRange(fieldName, min, max) {
  return (req, res, next) => {
    const value = req.body[fieldName];
    
    if (value !== undefined && value !== null) {
      const num = Number(value);
      if (isNaN(num)) {
        return res.status(400).json({
          success: false,
          error: `Field ${fieldName} must be a number`,
          field: fieldName
        });
      }
      
      if (num < min || num > max) {
        return res.status(400).json({
          success: false,
          error: `Field ${fieldName} must be between ${min} and ${max}`,
          field: fieldName
        });
      }
    }
    
    next();
  };
}

/**
 * Validate date format (ISO 8601)
 */
function validateDate(fieldName = 'date') {
  return (req, res, next) => {
    const dateStr = req.body[fieldName];
    
    if (dateStr) {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)',
          field: fieldName
        });
      }
    }
    
    next();
  };
}

/**
 * Validate enum value
 */
function validateEnum(fieldName, allowedValues) {
  return (req, res, next) => {
    const value = req.body[fieldName];
    
    if (value && !allowedValues.includes(value)) {
      return res.status(400).json({
        success: false,
        error: `Invalid value for ${fieldName}. Allowed values: ${allowedValues.join(', ')}`,
        field: fieldName,
        allowed_values: allowedValues
      });
    }
    
    next();
  };
}

/**
 * Combine multiple validators
 */
function combineValidators(...validators) {
  return (req, res, next) => {
    let index = 0;
    
    function runNext() {
      if (index >= validators.length) {
        return next();
      }
      
      const validator = validators[index++];
      validator(req, res, (err) => {
        if (err) {
          return next(err);
        }
        runNext();
      });
    }
    
    runNext();
  };
}

module.exports = {
  validateRequired,
  validateEmailField,
  validatePhoneField,
  validateUUID,
  validateNumericRange,
  validateDate,
  validateEnum,
  combineValidators
};

