/**
 * Chat Commands API
 * Handles natural language commands from the chat widget
 * Commands: "email X", "call Y", "sms Z", "show customers", etc.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const { chatLimiter } = require('../middleware/rate-limiter');
const ChatLLMService = require('../services/platform/chat-llm-service');
const CommandHandler = require('../services/platform/command-handler');
const promotionCommands = require('../services/commands/promotion-commands');
const { normalizeToE164 } = require('../utils/phone-e164');

// Register promotion commands
CommandHandler.register('promotion', promotionCommands);

/**
 * Parse command and determine action
 */
function parseCommand(command) {
  const cmd = command.toLowerCase().trim();

  // Email command: "email john@example.com" or "email john"
  const emailMatch = cmd.match(/^email\s+(.+)$/);
  if (emailMatch) {
    return {
      action: 'email',
      target: emailMatch[1].trim()
    };
  }

  // Call command: "call +1234567890" or "call john"
  const callMatch = cmd.match(/^call\s+(.+)$/);
  if (callMatch) {
    return {
      action: 'call',
      target: callMatch[1].trim()
    };
  }

  // SMS command: "sms +1234567890" or "sms john"
  const smsMatch = cmd.match(/^sms\s+(.+)$/);
  if (smsMatch) {
    return {
      action: 'sms',
      target: smsMatch[1].trim()
    };
  }

  // Show command: "show customers", "show orders", etc.
  const showMatch = cmd.match(/^show\s+(.+)$/);
  if (showMatch) {
    return {
      action: 'show',
      target: showMatch[1].trim()
    };
  }

  // Help command - recognize various help-related phrases
  const helpPhrases = [
    'help',
    'what can you do',
    'what else can you do',
    'what are my options',
    'show me options',
    'what commands',
    'available commands',
    'how can you help',
    'what do you do',
    'capabilities',
    'features'
  ];

  for (const phrase of helpPhrases) {
    if (cmd.includes(phrase)) {
      return {
        action: 'help'
      };
    }
  }

  return {
    action: 'unknown',
    target: command
  };
}

/**
 * Find customer by email, phone, or name
 */
async function findCustomer(target, merchantId) {
  // Try email first
  if (target.includes('@')) {
    const customer = db.getCustomerByEmail(target);
    if (customer && customer.merchant_id === merchantId) {
      return customer;
    }
  }

  // Try phone number
  const phoneMatch = target.match(/[\d\s\-\+\(\)]+/);
  if (phoneMatch) {
    const phone = phoneMatch[0].replace(/[\s\-\(\)]/g, '');
    if (phone.length >= 10) {
      const customer = db.getCustomerByPhone(phone);
      if (customer && customer.merchant_id === merchantId) {
        return customer;
      }
    }
  }

  // Try name search
  const customers = db.getCustomerByName(target, merchantId);
  if (customers && customers.length > 0) {
    // Return first match
    return customers[0];
  }

  return null;
}

/**
 * Handle email command
 */
async function handleEmailCommand(target, merchantId, customerId) {
  const customer = await findCustomer(target, merchantId);

  if (!customer) {
    return {
      error: `Customer not found: ${target}. Try using email, phone, or name.`
    };
  }

  return {
    action: 'email_composer',
    recipient: customer.email || target,
    customerId: customer.id,
    message: `Opening email composer for ${customer.name || customer.email}...`
  };
}

/**
 * Handle call command
 */
function normalizePhoneNumber(phone) {
  if (!phone) return phone;
  const e164 = normalizeToE164(phone);
  return e164 || phone;
}

async function handleCallCommand(target, merchantId, customerId) {
  // Try to find customer first, but allow calling phone numbers directly
  let customer = await findCustomer(target, merchantId);
  let phone = target;

  // If customer found, use their phone number
  if (customer && customer.phone_number) {
    phone = customer.phone_number;
  } else {
    // No customer found - normalize the phone number
    // Remove all non-digit characters first, then normalize
    const digitsOnly = target.replace(/\D/g, '');

    if (digitsOnly.length >= 10) {
      // Normalize phone number
      phone = normalizePhoneNumber(target);
    } else {
      // If it's not a phone number, check if it's a name/email and we should search
      if (!target.match(/^[\d\s\-\+\(\)]+$/)) {
        return {
          error: `Customer not found: ${target}. Try using a phone number (e.g., +18622307479 or 8622307479) or search for customers first with "show customers".`
        };
      }
      phone = normalizePhoneNumber(target);
    }
  }

  // Final validation - ensure it's a valid phone number format
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return {
      error: `Invalid phone number: ${target}. Please provide a valid phone number (e.g., +18622307479 or 8622307479).`
    };
  }

  // Initiate outbound call
  try {
    const RetellService = require('../services/voice/retell-service');
    const retellService = new RetellService();
    const merchant = db.getMerchant(merchantId);

    if (!merchant) {
      return {
        error: 'Merchant not found'
      };
    }

    // Get Retell agent ID from merchant/clinic
    const clinic = db.getClinicBySlug(merchant.subdomain || '');
    const retellAgentId = clinic?.retell_agent_id || process.env.RETELL_AGENT_ID;

    if (!retellAgentId) {
      return {
        error: 'Voice agent not configured. Please configure your voice agent settings.'
      };
    }

    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      return {
        error: 'Twilio phone number not configured. Please configure TWILIO_PHONE_NUMBER.'
      };
    }

    const call = await retellService.createOutboundCall(
      retellAgentId,
      fromNumber,
      phone,
      {
        override_agent_id: retellAgentId
      }
    );

    return {
      action: 'call_initiated',
      phone: phone,
      callId: call.call_id,
      message: `Call initiated to ${customer ? (customer.name || phone) : phone}`
    };
  } catch (error) {
    console.error('Call initiation error:', error);
    return {
      error: `Failed to initiate call: ${error.message}`
    };
  }
}

/**
 * Handle SMS command
 */
async function handleSMSCommand(target, merchantId, customerId) {
  const customer = await findCustomer(target, merchantId);

  if (!customer) {
    return {
      error: `Customer not found: ${target}. Try using email, phone, or name.`
    };
  }

  const phone = customer.phone_number || target;

  // Validate phone number
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  if (!phoneRegex.test(phone)) {
    return {
      error: `Invalid phone number: ${phone}. Please provide a valid phone number.`
    };
  }

  return {
    action: 'sms_composer',
    phone: phone,
    customerId: customer.id,
    message: `Opening SMS composer for ${customer.name || phone}...`
  };
}

/**
 * Handle show command
 */
async function handleShowCommand(target, merchantId) {
  const showType = target.toLowerCase().trim();

  if (showType.includes('customer')) {
    // Get customers from orders (for shop tenants) or customers table
    const orders = db.getAllOrders(merchantId);
    const customerMap = new Map();

    // Extract unique customers from orders
    orders.forEach(order => {
      if (order.customer_email && !customerMap.has(order.customer_email)) {
        customerMap.set(order.customer_email, {
          id: order.customer_id || order.customer_email,
          name: order.customer_name || order.customer_email,
          email: order.customer_email,
          phone_number: order.customer_phone || null
        });
      }
    });

    // Also get from customers table
    try {
      const customersFromDb = db.db.prepare('SELECT * FROM customers WHERE merchant_id = ? LIMIT 50').all(merchantId);
      customersFromDb.forEach(customer => {
        if (customer.email && !customerMap.has(customer.email)) {
          customerMap.set(customer.email, customer);
        }
      });
    } catch (e) {
      // If customers table doesn't have merchant_id, try without filter
      try {
        const allCustomers = db.db.prepare('SELECT * FROM customers LIMIT 50').all();
        allCustomers.forEach(customer => {
          if (customer.email && !customerMap.has(customer.email)) {
            customerMap.set(customer.email, customer);
          }
        });
      } catch (e2) {
        console.warn('Could not fetch customers:', e2.message);
      }
    }

    const customers = Array.from(customerMap.values());
    return {
      action: 'show_results',
      resultType: 'customers',
      results: customers.slice(0, 20),
      message: `Found ${customers.length} customer(s)`
    };
  }

  if (showType.includes('order')) {
    const orders = db.getAllOrders(merchantId);
    return {
      action: 'show_results',
      resultType: 'orders',
      results: orders.slice(0, 20),
      message: `Found ${orders.length} order(s)`
    };
  }

  if (showType.includes('product')) {
    const products = db.getProductsByMerchant(merchantId);
    return {
      action: 'show_results',
      resultType: 'products',
      results: products.slice(0, 20),
      totalCount: products.length,
      message: `You have ${products.length} product${products.length !== 1 ? 's' : ''} in your catalog. Showing first ${Math.min(20, products.length)}:`
    };
  }

  return {
    error: `Unknown show command: ${target}. Try "show customers", "show orders", or "show products".`
  };
}

/**
 * Handle count command - return just the count, not full list
 */
async function handleCountCommand(target, merchantId) {
  const countType = target.toLowerCase().trim();

  if (countType.includes('product')) {
    const products = db.getProductsByMerchant(merchantId);
    return {
      action: 'count_result',
      resultType: 'products',
      count: products.length,
      message: `You have ${products.length} product${products.length !== 1 ? 's' : ''} in your catalog.`
    };
  }

  if (countType.includes('customer')) {
    const orders = db.getAllOrders(merchantId);
    const customerMap = new Map();
    orders.forEach(order => {
      if (order.customer_email && !customerMap.has(order.customer_email)) {
        customerMap.set(order.customer_email, true);
      }
    });
    try {
      const customersFromDb = db.db.prepare('SELECT DISTINCT email FROM customers WHERE merchant_id = ? AND email IS NOT NULL').all(merchantId);
      customersFromDb.forEach(customer => {
        if (customer.email) customerMap.set(customer.email, true);
      });
    } catch (e) {
      // Ignore if query fails
    }
    const customerCount = customerMap.size;
    return {
      action: 'count_result',
      resultType: 'customers',
      count: customerCount,
      message: `You have ${customerCount} customer${customerCount !== 1 ? 's' : ''}.`
    };
  }

  if (countType.includes('order')) {
    const orders = db.getAllOrders(merchantId);
    return {
      action: 'count_result',
      resultType: 'orders',
      count: orders.length,
      message: `You have ${orders.length} order${orders.length !== 1 ? 's' : ''}.`
    };
  }

  return {
    error: `Unknown count query: ${target}. Try asking "how many products", "how many customers", or "how many orders".`
  };
}

/**
 * Handle help command
 */
function handleHelpCommand() {
  const helpCommands = CommandHandler.getHelp();

  let helpMessage = `Available commands:
• email <customer> - Open email composer
• call <customer> - Initiate outbound call
• sms <customer> - Open SMS composer
• show customers - List customers
• show orders - List orders
• show products - List products
• show promotions - List promotions`;

  // Add registered command handlers
  if (helpCommands && helpCommands.length > 0) {
    helpCommands.forEach(cmd => {
      if (cmd.examples && cmd.examples.length > 0) {
        helpMessage += `\n• ${cmd.examples[0]}`;
      }
    });
  }

  helpMessage += `\n• help - Show this help message

Examples:
• email john@example.com
• call +1234567890
• sms John Smith
• show customers
• create a 20% off promotion for cookies
• email customers about the sale`;

  return {
    action: 'help',
    message: helpMessage
  };
}

/**
 * POST /api/chat/command
 * Process a chat command
 */
router.post('/command', chatLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const { command, conversationHistory = [] } = req.body;
    const merchantId = req.customer?.merchant_id;
    const customerId = req.customer?.id;

    if (!command || !command.trim()) {
      return res.status(400).json({
        error: 'Command is required'
      });
    }

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    // Try extensible command handler first (for promotions, etc.)
    let result = null;
    let llmResponse = null;

    try {
      const commandParsed = await CommandHandler.parse(command, {
        merchantId,
        customerId,
        conversationHistory
      });

      if (commandParsed && commandParsed.matched) {
        // Execute via command handler
        result = await CommandHandler.execute(commandParsed, {
          merchantId,
          customerId,
          conversationHistory
        });

        // If command handler succeeded, return early
        if (result && result.success !== false) {
          // Add LLM response if available
          if (ChatLLMService.isAvailable()) {
            try {
              const llmResult = await ChatLLMService.understandCommand(command, {
                merchantId,
                conversationHistory
              });
              if (llmResult && llmResult.response) {
                result.llmResponse = llmResult.response;
              }
            } catch (e) {
              // Ignore LLM error
            }
          }

          return res.json(result);
        }
      }
    } catch (cmdError) {
      console.warn('Command handler error:', cmdError.message);
      // Continue to fallback parsers
    }

    // Try LLM first if available, fall back to regex parser
    let parsed = null;

    if (ChatLLMService.isAvailable()) {
      try {
        const llmResult = await ChatLLMService.understandCommand(command, {
          merchantId,
          conversationHistory
        });

        // Lower confidence threshold for help requests (they're conversational)
        const confidenceThreshold = llmResult?.action === 'help' ? 0.3 : 0.5;

        if (llmResult && llmResult.confidence > confidenceThreshold) {
          parsed = {
            action: llmResult.action,
            target: llmResult.target,
            llm: true,
            reasoning: llmResult.reasoning,
            response: llmResult.response
          };
          llmResponse = llmResult.response;
        } else if (llmResult && llmResult.action === 'help') {
          // Even if confidence is low, trust help requests from LLM
          parsed = {
            action: 'help',
            llm: true,
            reasoning: llmResult.reasoning,
            response: llmResult.response || 'Here are the available commands...'
          };
          llmResponse = llmResult.response;
        }
      } catch (llmError) {
        console.warn('LLM parsing failed, falling back to regex:', llmError.message);
      }
    }

    // Fall back to regex parser if LLM didn't work
    if (!parsed) {
      parsed = parseCommand(command);
      parsed.llm = false;
    }

    if (!result) {
      switch (parsed.action) {
        case 'email':
          result = await handleEmailCommand(parsed.target, merchantId, customerId);
          break;

        case 'call':
          result = await handleCallCommand(parsed.target, merchantId, customerId);
          break;

        case 'sms':
          result = await handleSMSCommand(parsed.target, merchantId, customerId);
          break;

        case 'show':
          result = await handleShowCommand(parsed.target, merchantId);
          break;

        case 'count':
          result = await handleCountCommand(parsed.target, merchantId);
          break;

        case 'help':
          result = handleHelpCommand();
          break;

        case 'clarify':
          // LLM asked for clarification
          result = {
            action: 'clarify',
            message: parsed.response || 'Could you provide more details?',
            needsClarification: true
          };
          break;

        default:
          // If LLM parsed but action is unknown, use LLM response
          if (parsed.llm && parsed.response) {
            result = {
              action: 'message',
              message: parsed.response
            };
          } else {
            result = {
              error: `Unknown command: "${command}". Type "help" for available commands.`
            };
          }
      }
    }

    // Add suggestions for common errors
    if (result.error) {
      const suggestions = getErrorSuggestions(result.error, parsed.action);
      if (suggestions.length > 0) {
        result.suggestions = suggestions;
      }

      // Try to get helpful LLM response for errors
      if (ChatLLMService.isAvailable() && parsed.llm) {
        try {
          const helpfulResponse = await ChatLLMService.getHelpfulResponse(command, {
            merchantId,
            error: result.error,
            availableOptions: suggestions
          });
          if (helpfulResponse) {
            result.helpfulResponse = helpfulResponse;
          }
        } catch (e) {
          // Ignore LLM error, use default suggestions
        }
      }
    }

    // Add LLM response if available (but not for count results - we use formatted message)
    if (llmResponse && !result.error && result.action !== 'count_result') {
      result.llmResponse = llmResponse;
    }

    res.json(result);
  } catch (error) {
    console.error('Chat command error:', error);

    // Provide helpful error messages with suggestions
    let errorMessage = `Failed to process command: ${error.message}`;
    let suggestions = [];

    if (error.message.includes('not found')) {
      suggestions = [
        'Try searching with a different name or email',
        'Use "show customers" to see all customers',
        'Check spelling and try again'
      ];
    } else if (error.message.includes('permission') || error.message.includes('auth')) {
      suggestions = [
        'Make sure you are logged in',
        'Refresh the page and try again'
      ];
    } else if (error.message.includes('rate limit')) {
      suggestions = [
        'You\'ve made too many requests. Please wait a moment and try again.',
        'Try again in a few seconds'
      ];
    }

    res.status(500).json({
      error: errorMessage,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    });
  }
});

/**
 * Get error suggestions based on error message and action
 */
function getErrorSuggestions(errorMessage, action) {
  const suggestions = [];

  if (errorMessage.includes('not found') || errorMessage.includes('No customer')) {
    suggestions.push('Try: "show customers" to see all customers');
    suggestions.push('Use email or phone number instead of name');
    if (action === 'email' || action === 'sms') {
      suggestions.push(`Try: "${action} customer@example.com"`);
    }
  } else if (errorMessage.includes('multiple')) {
    suggestions.push('Be more specific - use email or phone number');
    suggestions.push('Try: "show customers" to see all matches');
  } else if (errorMessage.includes('phone')) {
    suggestions.push('Format: +1234567890 or (123) 456-7890');
    suggestions.push('Include country code for international numbers');
  } else if (errorMessage.includes('email')) {
    suggestions.push('Format: customer@example.com');
    suggestions.push('Check for typos in the email address');
  }

  return suggestions;
}

module.exports = router;

