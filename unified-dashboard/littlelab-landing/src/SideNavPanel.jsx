import React, { useState } from 'react';

function NavIcon({ label, active, onClick, children }) {
  return (
    <button
      type="button"
      className={`side-nav-icon ${active ? 'is-active' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SideNavPanel() {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <nav className="side-nav" aria-label="Sidebar navigation">
        <NavIcon label="Contact us" active onClick={() => setOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92V19a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 3.18 2 2 0 0 1 4.11 1h2.09a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.62a2 2 0 0 1-.45 2.11l-.89.89a16 16 0 0 0 6 6l.89-.89a2 2 0 0 1 2.11-.45c.84.3 1.72.51 2.62.63A2 2 0 0 1 22 16.92z" />
          </svg>
        </NavIcon>
        <NavIcon label="Coming soon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="M5 12h14" />
          </svg>
        </NavIcon>
      </nav>

      <aside className={`contact-panel ${open ? 'is-open' : ''}`} aria-label="Contact us panel">
        <div className="contact-panel-head">
          <p className="contact-panel-kicker">Contact us</p>
          <button type="button" className="contact-panel-close" onClick={() => setOpen(false)} aria-label="Close contact panel">
            ×
          </button>
        </div>

        <div className="contact-meta">
          <p><strong>Phone:</strong> +1 862 230 7479</p>
          <p><strong>Location:</strong> New York, NY USA</p>
        </div>

        <form
          className="contact-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <label>
            Name
            <input type="text" name="name" required />
          </label>
          <label>
            Email
            <input type="email" name="email" required />
          </label>
          <label>
            Message
            <textarea name="message" rows={4} required />
          </label>
          <button type="submit">Send message</button>
          {submitted && <p className="contact-form-ok">Thanks! We received your message.</p>}
        </form>
      </aside>
    </>
  );
}

