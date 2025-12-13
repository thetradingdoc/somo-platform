/**
 * Chat Widget - Quick Actions Interface
 * Allows users to quickly send commands like "email X", "call Y", "sms Z"
 */

class ChatWidget {
  constructor() {
    this.isOpen = false;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.conversationHistory = []; // For LLM context
    this.init();
  }

  init() {
    // Load command history from localStorage
    const savedHistory = localStorage.getItem('chatCommandHistory');
    if (savedHistory) {
      try {
        this.commandHistory = JSON.parse(savedHistory);
      } catch (e) {
        this.commandHistory = [];
      }
    }

    this.createWidget();
    this.attachEventListeners();
  }

  createWidget() {
    // Create floating button
    const button = document.createElement('button');
    button.id = 'chat-widget-button';
    button.className = 'chat-widget-button';
    button.innerHTML = '💬';
    button.setAttribute('aria-label', 'Open chat');
    button.title = 'Quick Actions';

    // Create chat window
    const chatWindow = document.createElement('div');
    chatWindow.id = 'chat-widget-window';
    chatWindow.className = 'chat-widget-window hidden';
    chatWindow.innerHTML = `
      <div class="chat-widget-header">
        <h3>Quick Actions</h3>
        <button class="chat-widget-close" aria-label="Close chat">×</button>
      </div>
      <div class="chat-widget-messages" id="chat-widget-messages">
        <div class="chat-widget-welcome">
          <p>💬 Quick Actions</p>
          <p class="chat-widget-hint">You can use natural language or commands:</p>
          <ul>
            <li><code>"call 8622307479"</code> or <code>"ring up John"</code></li>
            <li><code>"email john@example.com"</code> or <code>"send email to John"</code></li>
            <li><code>"show customers"</code> or <code>"list all customers"</code></li>
            <li><code>"help"</code> for more options</li>
          </ul>
        </div>
      </div>
      <div class="chat-widget-input-container">
        <input 
          type="text" 
          id="chat-widget-input" 
          class="chat-widget-input" 
          placeholder="Type a command... (e.g., email john@example.com)"
          autocomplete="off"
        />
        <button class="chat-widget-send" aria-label="Send">Send</button>
      </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(chatWindow);

    this.button = button;
    this.chatWindow = chatWindow;
    this.messagesContainer = document.getElementById('chat-widget-messages');
    this.input = document.getElementById('chat-widget-input');
  }

  attachEventListeners() {
    // Toggle chat window
    this.button.addEventListener('click', () => this.toggle());

    // Close button
    const closeBtn = this.chatWindow.querySelector('.chat-widget-close');
    closeBtn.addEventListener('click', () => this.close());

    // Send button
    const sendBtn = this.chatWindow.querySelector('.chat-widget-send');
    sendBtn.addEventListener('click', () => this.handleSend());

    // Enter key to send
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory(1);
      }
    });

    // Show suggestions on focus
    this.input.addEventListener('focus', () => this.showSuggestions());

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    this.chatWindow.classList.remove('hidden');
    this.input.focus();
    this.showSuggestions();
  }

  close() {
    this.isOpen = false;
    this.chatWindow.classList.add('hidden');
    this.historyIndex = -1;
  }

  navigateHistory(direction) {
    if (this.commandHistory.length === 0) return;

    this.historyIndex += direction;

    if (this.historyIndex < 0) {
      this.historyIndex = -1;
      this.input.value = '';
      return;
    }

    if (this.historyIndex >= this.commandHistory.length) {
      this.historyIndex = this.commandHistory.length - 1;
    }

    this.input.value = this.commandHistory[this.historyIndex] || '';
  }

  showSuggestions() {
    // Show command suggestions as placeholder or tooltip
    const suggestions = [
      'email customer@example.com',
      'call +1234567890',
      'sms +1234567890',
      'show customers',
      'show orders',
      'help'
    ];

    // Update placeholder with rotating suggestion
    const randomSuggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
    this.input.placeholder = `Try: ${randomSuggestion}`;
  }

  async handleSend() {
    const command = this.input.value.trim();
    if (!command) return;

    // Add to history
    if (command && !this.commandHistory.includes(command)) {
      this.commandHistory.unshift(command);
      if (this.commandHistory.length > 50) {
        this.commandHistory.pop();
      }
      localStorage.setItem('chatCommandHistory', JSON.stringify(this.commandHistory));
    }

    // Reset history navigation
    this.historyIndex = -1;

    // Clear input
    this.input.value = '';

    // Add user message
    this.addMessage('user', command);

    // Show loading
    const loadingId = this.addMessage('assistant', 'Processing...', true);

    try {
      // Send command to backend with conversation history
      const response = await fetch('/api/chat/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          command,
          conversationHistory: this.conversationHistory.slice(-10) // Last 10 messages for context
        }),
      });

      const data = await response.json();

      // Remove loading message
      this.removeMessage(loadingId);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process command');
      }

      // Update conversation history for LLM context
      this.conversationHistory.push(
        { role: 'user', content: command },
        { role: 'assistant', content: data.llmResponse || data.message || JSON.stringify(data) }
      );
      // Keep only last 20 messages
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      // Handle response
      this.handleCommandResponse(data);

    } catch (error) {
      this.removeMessage(loadingId);
      this.addMessage('assistant', `❌ Error: ${error.message}`, false);
      console.error('Chat command error:', error);
    }
  }

  handleCommandResponse(data) {
    // Show LLM response if available (more conversational)
    // But skip if it's a count result - we'll show the formatted count instead
    if (data.llmResponse && data.action !== 'count_result') {
      this.addMessage('assistant', data.llmResponse, false);
    }

    if (data.error) {
      // Show helpful LLM response if available, otherwise show error
      if (data.helpfulResponse) {
        this.addMessage('assistant', `💡 ${data.helpfulResponse}`, false);
      } else {
        this.addMessage('assistant', `❌ ${data.error}`, false);
      }

      // Show suggestions if available
      if (data.suggestions && data.suggestions.length > 0) {
        const suggestionsHtml = `
          <div class="chat-suggestions">
            <small>💡 Suggestions:</small>
            <ul>
              ${data.suggestions.map(s => `<li>${s}</li>`).join('')}
            </ul>
          </div>
        `;
        this.addMessage('assistant', suggestionsHtml, false, true);
      }
      return;
    }

    // Handle different response types
    if (data.action === 'call_initiated') {
      this.addMessage('assistant', `📞 Call initiated to ${data.phone || 'customer'}`, false);
    } else if (data.action === 'email_composer') {
      this.addMessage('assistant', `📧 Opening email composer for ${data.recipient}...`, false);
      // Trigger email composer modal
      if (window.EmailComposer) {
        window.EmailComposer.open({
          recipient: data.recipient,
          customerId: data.customerId,
          templateId: data.templateId,
        });
      }
    } else if (data.action === 'sms_composer') {
      this.addMessage('assistant', `💬 Opening SMS composer for ${data.phone}...`, false);
      // Trigger SMS composer modal
      if (window.SMSComposer) {
        window.SMSComposer.open({
          phone: data.phone,
          customerId: data.customerId,
          templateId: data.templateId,
        });
      }
    } else if (data.action === 'count_result') {
      // Just show the count message - clean and simple
      this.addMessage('assistant', `📊 ${data.message}`, false);
    } else if (data.action === 'promotion_created' || data.action === 'promotion_activated' || data.action === 'promotion_deactivated') {
      // Show promotion action result
      this.addMessage('assistant', data.message || `✅ Promotion ${data.action.replace('promotion_', '')}`, false);
      if (data.promotion) {
        const promoHtml = `
          <div class="chat-result-item" style="margin-top: 10px;">
            <strong>${data.promotion.name}</strong>
            ${data.promotion.code ? `<br><small>Code: ${data.promotion.code}</small>` : ''}
            ${data.promotion.discount ? `<br><small>Discount: ${data.promotion.discount}</small>` : ''}
          </div>
        `;
        this.addMessage('assistant', promoHtml, false, true);
      }
    } else if (data.action === 'promotion_emailed') {
      // Show email result
      this.addMessage('assistant', data.message || `✅ Sent promotional email`, false);
    } else if (data.action === 'show_results') {
      // Only show message if it's not redundant with LLM response
      if (!data.llmResponse && data.message) {
        this.addMessage('assistant', data.message, false);
      }
      if (data.results && data.results.length > 0) {
        const resultsHtml = this.formatResults(data.results, data.resultType, data.totalCount);
        this.addMessage('assistant', resultsHtml, false, true);
      } else {
        this.addMessage('assistant', 'No results found.', false);
      }
    } else if (data.action === 'clarify' || data.needsClarification) {
      this.addMessage('assistant', `💬 ${data.message || 'Could you provide more details?'}`, false);
    } else if (data.action === 'message') {
      this.addMessage('assistant', data.message, false);
    } else if (data.message) {
      this.addMessage('assistant', data.message, false);
    } else {
      this.addMessage('assistant', '✅ Command executed successfully', false);
    }
  }

  formatResults(results, type, totalCount = null) {
    const displayCount = totalCount !== null ? totalCount : results.length;

    if (type === 'customers') {
      return `
        <div class="chat-results">
          <h4>Customers (${displayCount})</h4>
          ${results.slice(0, 5).map(c => `
            <div class="chat-result-item">
              <strong>${c.name || c.email}</strong>
              ${c.email ? `<br><small>${c.email}</small>` : ''}
              ${c.phone_number ? `<br><small>${c.phone_number}</small>` : ''}
            </div>
          `).join('')}
          ${results.length > 5 ? `<p><small>...and ${results.length - 5} more</small></p>` : ''}
        </div>
      `;
    } else if (type === 'orders') {
      return `
        <div class="chat-results">
          <h4>Orders (${displayCount})</h4>
          ${results.slice(0, 5).map(o => `
            <div class="chat-result-item">
              <strong>Order #${o.id?.substring(0, 8)}</strong>
              ${o.customer_name ? `<br><small>${o.customer_name}</small>` : ''}
              ${o.total_amount ? `<br><small>$${o.total_amount}</small>` : ''}
            </div>
          `).join('')}
          ${results.length > 5 ? `<p><small>...and ${results.length - 5} more</small></p>` : ''}
        </div>
      `;
    } else if (type === 'products') {
      return `
        <div class="chat-results">
          <h4>Products (${displayCount})</h4>
          ${results.slice(0, 10).map(p => `
            <div class="chat-result-item">
              <strong>${p.name || 'Unnamed Product'}</strong>
              ${p.category ? `<br><small>Category: ${p.category}</small>` : ''}
              ${p.price !== null && p.price !== undefined ? `<br><small>Price: $${p.price.toFixed(2)}</small>` : ''}
              ${p.inventory !== null && p.inventory !== undefined ? `<br><small>Stock: ${p.inventory}</small>` : ''}
            </div>
          `).join('')}
          ${results.length > 10 ? `<p><small>...and ${results.length - 10} more products</small></p>` : ''}
        </div>
      `;
    } else if (type === 'promotions') {
      return `
        <div class="chat-results">
          <h4>Promotions (${displayCount})</h4>
          ${results.slice(0, 10).map(p => `
            <div class="chat-result-item">
              <strong>${p.name || 'Unnamed Promotion'}</strong>
              ${p.code ? `<br><small>Code: ${p.code}</small>` : ''}
              ${p.discount ? `<br><small>Discount: ${p.discount}</small>` : ''}
              ${p.enabled ? `<br><small style="color: green;">✓ Active</small>` : `<br><small style="color: gray;">✗ Inactive</small>`}
              ${p.end_date ? `<br><small>Expires: ${new Date(p.end_date).toLocaleDateString()}</small>` : ''}
              ${p.max_uses ? `<br><small>Uses: ${p.current_uses || 0}/${p.max_uses}</small>` : ''}
            </div>
          `).join('')}
          ${results.length > 10 ? `<p><small>...and ${results.length - 10} more promotions</small></p>` : ''}
        </div>
      `;
    }
    // Fallback: format as simple list instead of raw JSON
    return `
      <div class="chat-results">
        <h4>Results (${results.length})</h4>
        ${results.slice(0, 10).map((item, idx) => `
          <div class="chat-result-item">
            ${JSON.stringify(item, null, 2)}
          </div>
        `).join('')}
        ${results.length > 10 ? `<p><small>...and ${results.length - 10} more</small></p>` : ''}
      </div>
    `;
  }

  addMessage(role, content, isLoading = false, isHtml = false) {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message chat-message-${role}`;
    messageDiv.id = messageId;
    if (isLoading) {
      messageDiv.classList.add('chat-message-loading');
    }

    if (isHtml) {
      messageDiv.innerHTML = content;
    } else {
      messageDiv.textContent = content;
    }

    // Remove welcome message if exists
    const welcome = this.messagesContainer.querySelector('.chat-widget-welcome');
    if (welcome) {
      welcome.remove();
    }

    this.messagesContainer.appendChild(messageDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

    return messageId;
  }

  removeMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) {
      message.remove();
    }
  }
}

// Initialize chat widget when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.chatWidget = new ChatWidget();
  });
} else {
  window.chatWidget = new ChatWidget();
}

