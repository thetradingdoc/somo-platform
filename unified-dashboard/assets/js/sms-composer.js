/**
 * SMS Composer Modal
 * Opens when chat widget triggers SMS action
 */

class SMSComposer {
  constructor() {
    this.modal = null;
    this.templates = [];
    this.currentTemplate = null;
    this.init();
  }

  init() {
    this.createModal();
    this.loadTemplates();
  }

  createModal() {
    const modal = document.createElement('div');
    modal.id = 'sms-composer-modal';
    modal.className = 'sms-composer-modal hidden';
    modal.innerHTML = `
      <div class="sms-composer-overlay"></div>
      <div class="sms-composer-container">
        <div class="sms-composer-header">
          <h2>💬 Compose SMS</h2>
          <button class="sms-composer-close" aria-label="Close">×</button>
        </div>
        <div class="sms-composer-body">
          <div class="sms-composer-field">
            <label>To:</label>
            <input type="tel" id="sms-composer-phone" class="sms-composer-input" placeholder="+1234567890" required>
          </div>
          <div class="sms-composer-field">
            <label>Template:</label>
            <select id="sms-composer-template" class="sms-composer-select">
              <option value="">-- Select Template --</option>
            </select>
          </div>
          <div class="sms-composer-field">
            <label>Message:</label>
            <textarea id="sms-composer-content" class="sms-composer-textarea" rows="6" placeholder="SMS message" maxlength="1600" required></textarea>
            <div class="sms-composer-counter">
              <span id="sms-composer-char-count">0</span> / 160 characters
              <span id="sms-composer-segments" class="sms-segments"></span>
            </div>
          </div>
          <div class="sms-composer-variables">
            <small>Available variables: {{customer_name}}, {{order_id}}, {{order_total}}, {{merchant_name}}</small>
          </div>
        </div>
        <div class="sms-composer-footer">
          <button class="sms-composer-cancel">Cancel</button>
          <button class="sms-composer-send">Send SMS</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;

    // Event listeners
    modal.querySelector('.sms-composer-overlay').addEventListener('click', () => this.close());
    modal.querySelector('.sms-composer-close').addEventListener('click', () => this.close());
    modal.querySelector('.sms-composer-cancel').addEventListener('click', () => this.close());
    modal.querySelector('.sms-composer-send').addEventListener('click', () => this.sendSMS());
    modal.querySelector('#sms-composer-template').addEventListener('change', (e) => this.loadTemplate(e.target.value));
    
    // Character counter
    const contentInput = modal.querySelector('#sms-composer-content');
    contentInput.addEventListener('input', () => this.updateCharCounter());

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  async loadTemplates() {
    try {
      const response = await fetch('/api/automation/templates?type=sms', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        this.templates = data.templates || [];
        this.populateTemplateSelect();
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  }

  populateTemplateSelect() {
    const select = this.modal.querySelector('#sms-composer-template');
    select.innerHTML = '<option value="">-- Select Template --</option>';
    this.templates.forEach(template => {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = template.name;
      select.appendChild(option);
    });
  }

  loadTemplate(templateId) {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) return;

    this.currentTemplate = template;
    const contentInput = this.modal.querySelector('#sms-composer-content');
    contentInput.value = template.content || '';
    this.updateCharCounter();
  }

  updateCharCounter() {
    const contentInput = this.modal.querySelector('#sms-composer-content');
    const charCount = contentInput.value.length;
    const charCountSpan = this.modal.querySelector('#sms-composer-char-count');
    const segmentsSpan = this.modal.querySelector('#sms-composer-segments');
    
    charCountSpan.textContent = charCount;
    
    // Calculate segments (160 chars per segment)
    const segments = Math.ceil(charCount / 160);
    if (segments > 1) {
      segmentsSpan.textContent = ` (${segments} segments)`;
      segmentsSpan.style.color = '#e53e3e';
    } else {
      segmentsSpan.textContent = '';
    }
    
    // Warning at 140 chars (approaching limit)
    if (charCount >= 140 && charCount < 160) {
      charCountSpan.style.color = '#f6ad55';
    } else if (charCount >= 160) {
      charCountSpan.style.color = '#e53e3e';
    } else {
      charCountSpan.style.color = '#718096';
    }
  }

  renderTemplate(template, variables = {}) {
    let rendered = template;
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      rendered = rendered.replace(regex, variables[key] || '');
    });
    return rendered;
  }

  open(options = {}) {
    const phoneInput = this.modal.querySelector('#sms-composer-phone');
    const contentInput = this.modal.querySelector('#sms-composer-content');
    const templateSelect = this.modal.querySelector('#sms-composer-template');

    // Set phone
    phoneInput.value = options.phone || '';
    
    // Set template if provided
    if (options.templateId) {
      templateSelect.value = options.templateId;
      this.loadTemplate(options.templateId);
    } else {
      templateSelect.value = '';
      contentInput.value = '';
    }

    this.updateCharCounter();

    // Store customer ID for variable replacement
    this.customerId = options.customerId;

    this.modal.classList.remove('hidden');
    phoneInput.focus();
  }

  close() {
    this.modal.classList.add('hidden');
    this.currentTemplate = null;
    this.customerId = null;
  }

  async sendSMS() {
    const phoneInput = this.modal.querySelector('#sms-composer-phone');
    const contentInput = this.modal.querySelector('#sms-composer-content');

    const phone = phoneInput.value.trim();
    const content = contentInput.value.trim();

    if (!phone || !content) {
      alert('Please fill in all required fields');
      return;
    }

    // Validate phone
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    if (!phoneRegex.test(phone)) {
      alert('Please enter a valid phone number');
      return;
    }

    // Validate length
    if (content.length > 1600) {
      alert('Message is too long. Maximum 1600 characters.');
      return;
    }

    // Get variables if customer ID is available
    let variables = {};
    if (this.customerId) {
      try {
        const customerResponse = await fetch(`/api/customers/${this.customerId}`, {
          credentials: 'include'
        });
        if (customerResponse.ok) {
          const customer = await customerResponse.json();
          variables = {
            customer_name: customer.name || customer.email,
            customer_email: customer.email,
            merchant_name: 'Your Business'
          };
        }
      } catch (e) {
        console.warn('Could not load customer variables:', e);
      }
    }

    // Render template with variables
    const renderedContent = this.renderTemplate(content, variables);

    try {
      const response = await fetch('/api/automation/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          phone_number: phone,
          content: renderedContent,
          customer_id: this.customerId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send SMS');
      }

      alert('SMS sent successfully!');
      this.close();
    } catch (error) {
      console.error('Send SMS error:', error);
      alert(`Failed to send SMS: ${error.message}`);
    }
  }
}

// Initialize and expose globally
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.SMSComposer = new SMSComposer();
  });
} else {
  window.SMSComposer = new SMSComposer();
}

