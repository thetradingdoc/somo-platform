/**
 * Chat LLM Service
 * Uses Groq LLM to understand natural language commands and convert them to structured actions
 */

const Groq = require('groq-sdk');
const db = require('../database');

class ChatLLMService {
    constructor() {
        this.groq = null;
        if (process.env.GROQ_API_KEY) {
            this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        }
    }

    /**
     * Check if LLM is available
     */
    isAvailable() {
        return !!this.groq;
    }

    /**
     * Understand natural language command and convert to structured action
     */
    async understandCommand(userMessage, context = {}) {
        if (!this.isAvailable()) {
            return null; // Fall back to regex parser
        }

        const { merchantId, conversationHistory = [] } = context;

        // Get merchant context
        const merchant = merchantId ? db.getMerchant(merchantId) : null;
        const merchantName = merchant?.name || 'the business';

        // Build system prompt
        const systemPrompt = `You are a helpful assistant for ${merchantName}. You help business owners manage their customers, orders, and communications.

Available actions:
1. **call** - Initiate a phone call to a customer or phone number
   Examples: "call John", "call +1234567890", "ring up 8622307479"
   
2. **email** - Open email composer for a customer
   Examples: "email john@example.com", "send email to John Smith"
   
3. **sms** - Open SMS composer for a customer
   Examples: "text John", "sms +1234567890", "send SMS to customer"
   
4. **show** - Display information (full list)
   Examples: "show customers", "list orders", "show products", "show promotions"
   
5. **count** - Get count/statistics (just the number, not full list)
   Examples: "how many products", "how many customers do I have", "count orders", "product count"
   
6. **promotion** - Manage promotions (create, activate, deactivate, email customers)
   Examples: "create a 20% off promotion for cookies", "activate cookies promotion", "email customers about the sale", "show promotions"
   
7. **help** - Show available commands
   Examples: "help", "what can you do", "what else can you do", "show me options", "what are my options", "how can you help"

IMPORTANT: 
- If the user asks "how many" or "count" questions, return action: "count" with target: "products", "customers", or "orders"
- If the user mentions "promotion", "sale", "discount", "coupon", return action: "promotion" with target containing the promotion details
- If the user asks about capabilities, options, what you can do, or wants to see available commands, ALWAYS return action: "help" with high confidence (0.9+).

When the user wants to call someone, you should:
- Extract the phone number or customer identifier
- Return action: "call" with target containing the phone number or customer name/email
- If it's just digits (like "8622307479"), treat it as a phone number

When the user wants to email or SMS:
- Extract the customer identifier (email, phone, or name)
- Return the appropriate action

Be conversational and helpful. If the user's intent is unclear, ask for clarification.

Return your response as JSON with this structure:
{
  "action": "call" | "email" | "sms" | "show" | "count" | "help" | "clarify",
  "target": "phone number, email, customer identifier, or 'products'/'customers'/'orders' for count",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of what you understood",
  "response": "friendly, concise response to the user (keep it short, under 20 words)"
}`;

        try {
            // Build conversation messages
            const messages = [
                { role: 'system', content: systemPrompt },
                ...conversationHistory.slice(-5), // Last 5 messages for context
                { role: 'user', content: userMessage }
            ];

            const completion = await this.groq.chat.completions.create({
                messages: messages,
                model: 'llama-3.1-8b-instant', // Fast and efficient
                temperature: 0.3, // Lower temperature for more consistent parsing
                max_tokens: 200,
                response_format: { type: 'json_object' }
            });

            const response = completion.choices[0]?.message?.content;
            if (!response) {
                return null;
            }

            try {
                const parsed = JSON.parse(response);
                return {
                    action: parsed.action || 'unknown',
                    target: parsed.target || '',
                    confidence: parsed.confidence || 0.5,
                    reasoning: parsed.reasoning || '',
                    response: parsed.response || '',
                    llm: true
                };
            } catch (parseError) {
                console.error('Failed to parse LLM response:', parseError);
                return null;
            }
        } catch (error) {
            console.error('LLM service error:', error.message);
            return null; // Fall back to regex parser
        }
    }

    /**
     * Get helpful response for errors or clarifications
     */
    async getHelpfulResponse(userMessage, context = {}) {
        if (!this.isAvailable()) {
            return null;
        }

        const { merchantId, error, availableOptions = [] } = context;

        const systemPrompt = `You are a helpful assistant. Provide friendly, concise responses to help users.

If there's an error, explain it clearly and suggest solutions.
If clarification is needed, ask a helpful question.
Keep responses under 50 words.`;

        try {
            const messages = [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `User said: "${userMessage}"\n\nError: ${error || 'None'}\nAvailable options: ${availableOptions.join(', ')}\n\nProvide a helpful response.`
                }
            ];

            const completion = await this.groq.chat.completions.create({
                messages: messages,
                model: 'llama-3.1-8b-instant',
                temperature: 0.7,
                max_tokens: 100
            });

            return completion.choices[0]?.message?.content?.trim() || null;
        } catch (error) {
            console.error('LLM helpful response error:', error.message);
            return null;
        }
    }
}

module.exports = new ChatLLMService();

