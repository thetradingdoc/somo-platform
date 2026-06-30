/**
 * Admin AI Assistant - Sidebar Chat Interface
 * Provides natural language interface for admin portal operations
 */

class AdminAIAssistant {
  constructor() {
    this.isOpen = false;
    this.conversationHistory = [];
    this.apiBase = window.API_BASE || '';
    this.init();
  }

  init() {
    this.createSidebar();
    this.attachEventListeners();
  }

  createSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'admin-ai-sidebar';
    sidebar.className = 'admin-ai-sidebar';
    sidebar.innerHTML = `
      <div class="admin-ai-header">
        <h3>🤖 AI Assistant</h3>
        <button class="admin-ai-toggle" aria-label="Toggle sidebar">◀</button>
      </div>
      <div class="admin-ai-messages" id="admin-ai-messages">
        <div class="admin-ai-welcome">
          <p><strong>AI Assistant</strong></p>
          <p style="font-size:13px;color:var(--muted);margin-top:8px;">Ask me anything about your leads:</p>
          <ul style="font-size:12px;color:var(--muted);margin-top:8px;padding-left:20px;">
            <li>"Show me 10 high-value leads in NY"</li>
            <li>"What's our conversion rate?"</li>
            <li>"Which leads should I call today?"</li>
            <li>"Show qualified leads"</li>
          </ul>
        </div>
      </div>
      <div class="admin-ai-input-container">
        <input 
          type="text" 
          id="admin-ai-input" 
          class="admin-ai-input" 
          placeholder="Ask me anything..."
          autocomplete="off"
        />
        <button class="admin-ai-send" aria-label="Send">Send</button>
      </div>
    `;

    document.body.appendChild(sidebar);
    this.sidebar = sidebar;
    this.messagesContainer = document.getElementById('admin-ai-messages');
    this.input = document.getElementById('admin-ai-input');
  }

  attachEventListeners() {
    // Toggle sidebar
    const toggleBtn = this.sidebar.querySelector('.admin-ai-toggle');
    toggleBtn.addEventListener('click', () => this.toggle());

    // Send button
    const sendBtn = this.sidebar.querySelector('.admin-ai-send');
    sendBtn.addEventListener('click', () => this.handleSend());

    // Enter key to send
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  toggle() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.sidebar.classList.add('open');
      this.input.focus();
    } else {
      this.sidebar.classList.remove('open');
    }
  }

  async handleSend() {
    const message = this.input.value.trim();
    if (!message) return;

    // Add user message to UI
    this.addMessage('user', message);
    this.input.value = '';
    this.input.disabled = true;

    // Show loading
    const loadingId = this.addMessage('assistant', 'Thinking...', true);

    try {
      const response = await fetch(`${this.apiBase}/api/admin/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          conversationHistory: this.conversationHistory
        })
      });

      const data = await response.json();
      
      // Remove loading message
      this.removeMessage(loadingId);

      if (data.success) {
        // Add assistant response
        let responseText = data.message || data.response || 'Action completed';
        
        // If there's a result, format it nicely
        if (data.result) {
          if (data.action === 'show_leads' && data.result.leads) {
            responseText = `Found ${data.result.count} lead(s):\n\n`;
            data.result.leads.slice(0, 5).forEach(lead => {
              responseText += `• ${lead.clinic_name} (Score: ${lead.score}, ${lead.location})\n`;
            });
            if (data.result.leads.length > 5) {
              responseText += `\n... and ${data.result.leads.length - 5} more`;
            }
          } else if (data.action === 'suggest_call_list' && data.result.leads) {
            responseText = `Top ${data.result.count} call-ready leads:\n\n`;
            data.result.leads.forEach((lead) => {
              responseText += `• ${lead.clinic_name} (id: ${lead.id})\n`;
            });
          } else if (data.action === 'run_scrape') {
            const lr = data.result.last_scrape || {};
            responseText = `Last scrape: ${lr.saved_callable ?? lr.saved ?? 0} callable, ${lr.saved_needs_phone ?? 0} need phone. Needs phone queue: ${data.result.leads?.needs_phone ?? 0}.`;
          } else if (data.action === 'show_stats') {
            const stats = data.result;
            responseText = `Statistics:\n`;
            if (stats.total_leads !== undefined) responseText += `Total Leads: ${stats.total_leads}\n`;
            if (stats.qualified_leads !== undefined) responseText += `Qualified: ${stats.qualified_leads}\n`;
            if (stats.conversion_rate !== undefined) responseText += `Conversion Rate: ${stats.conversion_rate}%\n`;
            if (stats.calls_used !== undefined) responseText += `Calls Used: ${stats.calls_used}/${stats.calls_remaining || 250}\n`;
          } else if (data.action === 'navigate') {
            responseText = `Navigating to ${data.result.tab}...`;
            // Trigger navigation
            const tabBtn = document.querySelector(`[data-tab="${data.result.tab}"]`);
            if (tabBtn) tabBtn.click();
          }
        }

        this.addMessage('assistant', responseText);

        if (data.action === 'call_lead' && data.requires_confirm && data.lead_id) {
          this.addConfirmCallButton(data.lead_id, data.lead_name || data.message);
        }

        // Update conversation history
        this.conversationHistory.push(
          { role: 'user', content: message },
          { role: 'assistant', content: responseText }
        );

        // Keep only last 10 messages for context
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }
      } else {
        this.addMessage('assistant', `Error: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.removeMessage(loadingId);
      this.addMessage('assistant', `Error: ${error.message}`);
    }

    this.input.disabled = false;
    this.input.focus();
  }

  addMessage(role, content, isTemporary = false) {
    const messageDiv = document.createElement('div');
    const messageId = isTemporary ? `temp-${Date.now()}` : null;
    if (messageId) messageDiv.id = messageId;
    messageDiv.className = `admin-ai-message admin-ai-message-${role}`;
    messageDiv.textContent = content;
    
    this.messagesContainer.appendChild(messageDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

    return messageId;
  }

  removeMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) message.remove();
  }

  addConfirmCallButton(leadId, label) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-ai-message admin-ai-message-assistant';
    wrap.style.marginTop = '4px';
    const btn = document.createElement('button');
    btn.className = 'admin-crm-btn-outline btn-sm';
    btn.textContent = 'Confirm call';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (window.AdminShell?.callLead) {
          await AdminShell.callLead(leadId, label || 'lead', { skipConfirm: true });
        }
        btn.textContent = 'Call initiated';
      } catch (e) {
        btn.textContent = 'Failed';
      }
    };
    wrap.appendChild(btn);
    this.messagesContainer.appendChild(wrap);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.adminAIAssistant = new AdminAIAssistant();
  });
} else {
  window.adminAIAssistant = new AdminAIAssistant();
}

