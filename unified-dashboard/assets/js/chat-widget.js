/**
 * Chat Widget - Voice-first Quick Actions
 * Text commands + in-browser voice call via ElevenLabs Conversational AI (demo)
 */

class ChatWidget {
  constructor() {
    this.isOpen = false;
    this.isCallActive = false;
    this.commandHistory = [];
    this.historyIndex = -1;
    this.conversationHistory = [];
    this.elevenLabsConversation = null;
    this.elevenLabsSdkLoaded = false;
    this.init();
  }

  getApiBase() {
    return (typeof window !== 'undefined' && window.API_BASE) || '';
  }

  init() {
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
    const button = document.createElement('button');
    button.id = 'chat-widget-button';
    button.className = 'chat-widget-button';
    button.innerHTML = '💬';
    button.setAttribute('aria-label', 'Open chat');
    button.title = 'Quick Actions';

    const chatWindow = document.createElement('div');
    chatWindow.id = 'chat-widget-window';
    chatWindow.className = 'chat-widget-window hidden';
    chatWindow.innerHTML = `
      <div class="chat-widget-header">
        <h3>Quick Actions</h3>
        <button class="chat-widget-close" aria-label="Close chat">×</button>
      </div>
      <div class="chat-widget-voice-section">
        <div class="chat-widget-voice-circle">
          <div class="chat-widget-voice-circle-bg"></div>
          <button class="chat-widget-voice-btn" id="chat-widget-voice-btn" aria-label="Start voice call" title="Talk to agent">
            📞
          </button>
        </div>
        <p class="chat-widget-voice-hint">Tap to talk to the AI agent</p>
      </div>
      <div class="chat-widget-messages" id="chat-widget-messages"></div>
      <div class="chat-widget-input-container">
        <input 
          type="text" 
          id="chat-widget-input" 
          class="chat-widget-input" 
          placeholder="Or send a message"
          autocomplete="off"
        />
        <button class="chat-widget-send" aria-label="Send">✈</button>
      </div>
      <div class="chat-widget-footer">
        <span class="chat-widget-powered">Powered by Consʌlt</span>
        <button class="chat-widget-footer-btn" id="chat-widget-minimize" aria-label="Minimize">⌄</button>
        <button class="chat-widget-footer-btn" id="chat-widget-expand" aria-label="Expand">⛶</button>
      </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(chatWindow);

    this.button = button;
    this.chatWindow = chatWindow;
    this.messagesContainer = document.getElementById('chat-widget-messages');
    this.input = document.getElementById('chat-widget-input');
    this.voiceBtn = document.getElementById('chat-widget-voice-btn');
  }

  attachEventListeners() {
    this.button.addEventListener('click', () => this.toggle());
    this.chatWindow.querySelector('.chat-widget-close').addEventListener('click', () => this.close());
    this.chatWindow.querySelector('.chat-widget-send').addEventListener('click', () => this.handleSend());
    this.voiceBtn.addEventListener('click', () => this.handleVoiceClick());
    this.chatWindow.querySelector('#chat-widget-minimize').addEventListener('click', () => this.close());
    this.chatWindow.querySelector('#chat-widget-expand').addEventListener('click', () => this.toggleExpand());

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

    this.input.addEventListener('focus', () => this.showSuggestions());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  toggleExpand() {
    this.chatWindow.classList.toggle('chat-widget-expanded');
  }

  getElevenLabsConversation() {
    return window.ElevenLabsConversation || window.Conversation;
  }

  async loadElevenLabsSdk() {
    if (this.elevenLabsSdkLoaded && this.getElevenLabsConversation()) return true;

    // esm.sh bundles livekit-client and other deps
    try {
      const mod = await import('https://esm.sh/@11labs/client@0.2.0');
      if (mod && mod.Conversation) {
        window.ElevenLabsConversation = mod.Conversation;
        this.elevenLabsSdkLoaded = true;
        return true;
      }
    } catch (_) {}

    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@11labs/client@0.2.0/+esm');
      if (mod && mod.Conversation) {
        window.ElevenLabsConversation = mod.Conversation;
        this.elevenLabsSdkLoaded = true;
        return true;
      }
    } catch (_) {}

    return false;
  }

  async handleVoiceClick() {
    if (this.isCallActive) {
      this.endVoiceCall();
      return;
    }
    const apiBase = this.getApiBase();
    try {
      this.voiceBtn.disabled = true;
      this.voiceBtn.textContent = '…';
      const loaded = await this.loadElevenLabsSdk();
      const Conversation = this.getElevenLabsConversation();
      if (!loaded || !Conversation) {
        this.addMessage('assistant', 'Voice SDK could not be loaded. Check the browser console for errors.', false);
        this.voiceBtn.disabled = false;
        this.voiceBtn.textContent = '📞';
        return;
      }
      const res = await fetch(`${apiBase}/api/voice/web-call-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.signed_url) {
        throw new Error(data.error || 'Failed to get voice session');
      }
      await this.startVoiceCall(data.signed_url, Conversation);
    } catch (err) {
      this.addMessage('assistant', `❌ Voice: ${err.message}`, false);
    } finally {
      this.voiceBtn.disabled = false;
      if (!this.isCallActive) this.voiceBtn.textContent = '📞';
    }
  }

  async startVoiceCall(signedUrl, Conversation) {
    if (!Conversation) return;
    try {
      this.elevenLabsConversation = await Conversation.startSession({
        signedUrl,
        connectionType: 'websocket',
        onConnect: () => {
          this.isCallActive = true;
          this.voiceBtn.classList.add('chat-widget-voice-btn--calling');
          this.voiceBtn.textContent = '📵';
          this.voiceBtn.title = 'End call';
          this.button.classList.add('chat-widget-button--calling');
        },
        onDisconnect: () => {
          this.isCallActive = false;
          this.elevenLabsConversation = null;
          this.voiceBtn.classList.remove('chat-widget-voice-btn--calling');
          this.voiceBtn.textContent = '📞';
          this.voiceBtn.title = 'Talk to agent';
          this.button.classList.remove('chat-widget-button--calling');
        },
        onMessage: (msg) => {
          if (msg.role === 'agent' && msg.message) {
            // Optional: show agent transcript in chat
          }
        },
        onError: (err) => {
          this.addMessage('assistant', `❌ Voice error: ${err?.message || 'Unknown'}`, false);
          this.endVoiceCall();
        }
      });
    } catch (err) {
      this.addMessage('assistant', `❌ Could not start call: ${err?.message || 'Unknown'}`, false);
      this.isCallActive = false;
    }
  }

  endVoiceCall() {
    if (this.elevenLabsConversation) {
      this.elevenLabsConversation.endSession?.();
      this.elevenLabsConversation = null;
    }
    this.isCallActive = false;
    this.voiceBtn.classList.remove('chat-widget-voice-btn--calling');
    this.voiceBtn.textContent = '📞';
    this.voiceBtn.title = 'Talk to agent';
    this.button.classList.remove('chat-widget-button--calling');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
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
    const suggestions = ['email customer@example.com', 'call +1234567890', 'show customers', 'help'];
    const random = suggestions[Math.floor(Math.random() * suggestions.length)];
    this.input.placeholder = `Or send a message (e.g. ${random})`;
  }

  async handleSend() {
    const command = this.input.value.trim();
    if (!command) return;

    if (command && !this.commandHistory.includes(command)) {
      this.commandHistory.unshift(command);
      if (this.commandHistory.length > 50) this.commandHistory.pop();
      localStorage.setItem('chatCommandHistory', JSON.stringify(this.commandHistory));
    }
    this.historyIndex = -1;
    this.input.value = '';
    this.addMessage('user', command);

    const loadingId = this.addMessage('assistant', 'Processing...', true);
    const apiBase = this.getApiBase();

    try {
      const response = await fetch(`${apiBase}/api/chat/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          command,
          conversationHistory: this.conversationHistory.slice(-10)
        })
      });
      const data = await response.json();
      this.removeMessage(loadingId);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process command');
      }

      this.conversationHistory.push(
        { role: 'user', content: command },
        { role: 'assistant', content: data.llmResponse || data.message || JSON.stringify(data) }
      );
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }
      this.handleCommandResponse(data);
    } catch (error) {
      this.removeMessage(loadingId);
      this.addMessage('assistant', `❌ Error: ${error.message}`, false);
    }
  }

  handleCommandResponse(data) {
    if (data.llmResponse && data.action !== 'count_result') {
      this.addMessage('assistant', data.llmResponse, false);
    }
    if (data.error) {
      if (data.helpfulResponse) {
        this.addMessage('assistant', `💡 ${data.helpfulResponse}`, false);
      } else {
        this.addMessage('assistant', `❌ ${data.error}`, false);
      }
      if (data.suggestions && data.suggestions.length > 0) {
        const html = `<div class="chat-suggestions"><small>💡 Suggestions:</small><ul>${data.suggestions.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
        this.addMessage('assistant', html, false, true);
      }
      return;
    }
    if (data.action === 'call_initiated') {
      this.addMessage('assistant', `📞 Call initiated to ${data.phone || 'customer'}`, false);
    } else if (data.action === 'email_composer') {
      this.addMessage('assistant', `📧 Opening email for ${data.recipient}...`, false);
      if (window.EmailComposer) window.EmailComposer.open({ recipient: data.recipient, customerId: data.customerId, templateId: data.templateId });
    } else if (data.action === 'sms_composer') {
      this.addMessage('assistant', `💬 Opening SMS for ${data.phone}...`, false);
      if (window.SMSComposer) window.SMSComposer.open({ phone: data.phone, customerId: data.customerId, templateId: data.templateId });
    } else if (data.action === 'count_result') {
      this.addMessage('assistant', `📊 ${data.message}`, false);
    } else if (data.action === 'promotion_created' || data.action === 'promotion_activated' || data.action === 'promotion_deactivated') {
      this.addMessage('assistant', data.message || `✅ Promotion ${data.action.replace('promotion_', '')}`, false);
    } else if (data.action === 'show_results') {
      if (!data.llmResponse && data.message) this.addMessage('assistant', data.message, false);
      if (data.results && data.results.length > 0) {
        const html = this.formatResults(data.results, data.resultType, data.totalCount);
        this.addMessage('assistant', html, false, true);
      } else {
        this.addMessage('assistant', 'No results found.', false);
      }
    } else if (data.action === 'clarify' || data.needsClarification) {
      this.addMessage('assistant', `💬 ${data.message || 'Could you provide more details?'}`, false);
    } else if (data.action === 'message' || data.message) {
      this.addMessage('assistant', data.message || data.llmResponse, false);
    } else {
      this.addMessage('assistant', '✅ Command executed successfully', false);
    }
  }

  formatResults(results, type, totalCount = null) {
    const displayCount = totalCount !== null ? totalCount : results.length;
    if (type === 'customers') {
      return `<div class="chat-results"><h4>Customers (${displayCount})</h4>${results.slice(0, 5).map(c => `
        <div class="chat-result-item"><strong>${c.name || c.email}</strong>${c.email ? `<br><small>${c.email}</small>` : ''}${c.phone_number ? `<br><small>${c.phone_number}</small>` : ''}</div>
      `).join('')}${results.length > 5 ? `<p><small>...and ${results.length - 5} more</small></p>` : ''}</div>`;
    }
    if (type === 'orders') {
      return `<div class="chat-results"><h4>Orders (${displayCount})</h4>${results.slice(0, 5).map(o => `
        <div class="chat-result-item"><strong>Order #${(o.id || '').substring(0, 8)}</strong>${o.customer_name ? `<br><small>${o.customer_name}</small>` : ''}${o.total_amount ? `<br><small>$${o.total_amount}</small>` : ''}</div>
      `).join('')}${results.length > 5 ? `<p><small>...and ${results.length - 5} more</small></p>` : ''}</div>`;
    }
    if (type === 'products') {
      return `<div class="chat-results"><h4>Products (${displayCount})</h4>${results.slice(0, 10).map(p => `
        <div class="chat-result-item"><strong>${p.name || 'Unnamed'}</strong>${p.price != null ? `<br><small>$${p.price.toFixed(2)}</small>` : ''}</div>
      `).join('')}${results.length > 10 ? `<p><small>...and ${results.length - 10} more</small></p>` : ''}</div>`;
    }
    return `<div class="chat-results"><h4>Results (${results.length})</h4>${results.slice(0, 5).map(r => `<div class="chat-result-item">${JSON.stringify(r)}</div>`).join('')}</div>`;
  }

  addMessage(role, content, isLoading = false, isHtml = false) {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message chat-message-${role}`;
    messageDiv.id = messageId;
    if (isLoading) messageDiv.classList.add('chat-message-loading');
    messageDiv[isHtml ? 'innerHTML' : 'textContent'] = content;
    this.messagesContainer.classList.add('has-messages');
    this.messagesContainer.appendChild(messageDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    return messageId;
  }

  removeMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) message.remove();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.chatWidget = new ChatWidget();
  });
} else {
  window.chatWidget = new ChatWidget();
}
