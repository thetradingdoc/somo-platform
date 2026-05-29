import { useState } from 'react';
import { USE_CASES, requestDemoCall, signupUrl } from '../api/dodgecallDemo';

const PERSONAS = [
  'Receptionist',
  'Appointment Setter',
  'Lead Qualification',
  'Customer Service',
  'Debt Collection',
  'Survey'
];

export default function DemoSection() {
  const [useCase, setUseCase] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [activePersona, setActivePersona] = useState(-1);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!useCase) {
      setError('Please select a use case.');
      return;
    }
    if (!consent) {
      setError('Please agree to receive a one-time demo call.');
      return;
    }
    setStatus('loading');
    try {
      await requestDemoCall({
        name: name.trim(),
        phone: phone.trim(),
        use_case: useCase,
        consent: true
      });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Something went wrong. Please try again.');
    }
  };

  return (
    <section id="demo" className="dc-demo">
      <h2 className="dc-demo-title">
        Try Our
        <br />
        Live Demo
      </h2>

      <div className="dc-demo-grid">
        <div className="dc-demo-card dc-demo-card-visual">
          <div className="dc-orb" aria-hidden="true" />
          <div className="dc-persona-pills">
            {PERSONAS.map((label, i) => (
              <button
                key={label}
                type="button"
                className={`dc-pill ${activePersona === i ? 'dc-pill-active' : ''}`}
                onClick={() => {
                  setActivePersona(i);
                  const id = USE_CASES[i]?.id;
                  if (id) setUseCase(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="dc-demo-card dc-demo-card-form">
          <p className="dc-demo-lead">
            Receive a live call from our agent and discover how our AI caller transforms customer conversations.
          </p>

          {status === 'success' ? (
            <div className="dc-alert dc-alert-success">
              <strong>Calling you now!</strong>
              <p>Answer your phone — you should hear our AI demo agent shortly.</p>
              <a href={signupUrl()} className="dc-btn dc-btn-navy">
                Sign up for DodgeCall
              </a>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="dc-form">
              <label className="dc-field dc-field-underline">
                <span className="dc-label">Use Case</span>
                <select
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  disabled={status === 'loading'}
                  required
                >
                  <option value="">Select your use case</option>
                  {USE_CASES.map((uc) => (
                    <option key={uc.id} value={uc.id}>{uc.label}</option>
                  ))}
                </select>
              </label>

              <label className="dc-field dc-field-underline">
                <span className="dc-label">Name</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Your Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={status === 'loading'}
                />
              </label>

              <label className="dc-field dc-field-underline">
                <span className="dc-label">Phone Number</span>
                <input
                  type="tel"
                  required
                  placeholder="+15551234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={status === 'loading'}
                  autoComplete="tel"
                />
              </label>

              <label className="dc-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={status === 'loading'}
                />
                <span>
                  I agree to receive a one-time automated demo call at the number above. If I ask during the call,
                  DodgeCall may text me a signup link at this same number (message and data rates may apply).
                </span>
              </label>

              {error && <p className="dc-alert dc-alert-error" role="alert">{error}</p>}

              <button type="submit" className="dc-btn dc-btn-navy" disabled={status === 'loading'}>
                {status === 'loading' ? 'Calling you now…' : 'Get a call'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
