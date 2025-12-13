/**
 * Email Composer Modal
 * Opens when chat widget triggers email action
 */

class EmailComposer {
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
    modal.id = 'email-composer-modal';
    modal.className = 'email-composer-modal hidden';
    modal.innerHTML = `
      <div class="email-composer-overlay"></div>
      <div class="email-composer-container">
        <div class="email-composer-header">
          <h2>📧 Compose Email</h2>
          <button class="email-composer-close" aria-label="Close">×</button>
        </div>
        <div class="email-composer-body">
          <div class="email-composer-field">
            <label>To:</label>
            <input type="email" id="email-composer-to" class="email-composer-input" placeholder="recipient@example.com" required>
          </div>
          <div class="email-composer-field">
            <label>Template:</label>
            <select id="email-composer-template" class="email-composer-select">
              <option value="">-- Select Template --</option>
            </select>
          </div>
          <div class="email-composer-field">
            <label>Subject:</label>
            <input type="text" id="email-composer-subject" class="email-composer-input" placeholder="Email subject" required>
          </div>
          <div class="email-composer-field">
            <label>Message:</label>
            <textarea id="email-composer-content" class="email-composer-textarea" rows="10" placeholder="Email content" required></textarea>
          </div>
          <div class="email-composer-variables">
            <small>Available variables: {{customer_name}}, {{order_id}}, {{order_total}}, {{merchant_name}}</small>
          </div>
        </div>
        <div class="email-composer-footer">
          <button class="email-composer-cancel">Cancel</button>
          <button class="email-composer-send">Send Email</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;

    // Event listeners
    modal.querySelector('.email-composer-overlay').addEventListener('click', () => this.close());
    modal.querySelector('.email-composer-close').addEventListener('click', () => this.close());
    modal.querySelector('.email-composer-cancel').addEventListener('click', () => this.close());
    modal.querySelector('.email-composer-send').addEventListener('click', () => this.sendEmail());
    modal.querySelector('#email-composer-template').addEventListener('change', (e) => this.loadTemplate(e.target.value));

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  async loadTemplates() {
    try {
      const response = await fetch('/api/automation/templates?type=email', {
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
    const select = this.modal.querySelector('#email-composer-template');
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
    const subjectInput = this.modal.querySelector('#email-composer-subject');
    const contentInput = this.modal.querySelector('#email-composer-content');

    subjectInput.value = template.subject || '';
    contentInput.value = template.content || '';
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
    const toInput = this.modal.querySelector('#email-composer-to');
    const subjectInput = this.modal.querySelector('#email-composer-subject');
    const contentInput = this.modal.querySelector('#email-composer-content');
    const templateSelect = this.modal.querySelector('#email-composer-template');

    // Set recipient
    toInput.value = options.recipient || '';
    
    // Set template if provided
    if (options.templateId) {
      templateSelect.value = options.templateId;
      this.loadTemplate(options.templateId);
    } else {
      templateSelect.value = '';
      subjectInput.value = '';
      contentInput.value = '';
    }

    // Store customer ID for variable replacement
    this.customerId = options.customerId;

    this.modal.classList.remove('hidden');
    toInput.focus();
  }

  close() {
    this.modal.classList.add('hidden');
    this.currentTemplate = null;
    this.customerId = null;
  }

  async sendEmail() {
    const toInput = this.modal.querySelector('#email-composer-to');
    const subjectInput = this.modal.querySelector('#email-composer-subject');
    const contentInput = this.modal.querySelector('#email-composer-content');

    const recipient = toInput.value.trim();
    const subject = subjectInput.value.trim();
    const content = contentInput.value.trim();

    if (!recipient || !subject || !content) {
      alert('Please fill in all required fields');
      return;
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      alert('Please enter a valid email address');
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
    const renderedSubject = this.renderTemplate(subject, variables);
    const renderedContent = this.renderTemplate(content, variables);

    try {
      const response = await fetch('/api/automation/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          recipient,
          subject: renderedSubject,
          content: renderedContent,
          customer_id: this.customerId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      alert('Email sent successfully!');
      this.close();
    } catch (error) {
      console.error('Send email error:', error);
      alert(`Failed to send email: ${error.message}`);
    }
  }
}

// Initialize and expose globally
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.EmailComposer = new EmailComposer();
  });
} else {
  window.EmailComposer = new EmailComposer();
}

