import { useEffect, useState } from 'react';
import { USE_CASES, requestDemoCall, saveSignupPrefill, signupUrl } from '../api/somoDemo';
import CapIcon from './CapIcon';
import ParticleSphere from './ParticleSphere';

export default function DemoSection({ selectedUseCase = '', onUseCaseChange }) {
  const [useCase, setUseCase] = useState(selectedUseCase);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!selectedUseCase) return;
    setUseCase(selectedUseCase);
    const idx = USE_CASES.findIndex((uc) => uc.id === selectedUseCase);
    if (idx >= 0) setActiveIndex(idx);
  }, [selectedUseCase]);

  const selectUseCase = (id, index) => {
    setUseCase(id);
    setActiveIndex(index);
    onUseCaseChange?.(id);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!useCase) {
      setError('Please select a practice type.');
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
      saveSignupPrefill({
        name: name.trim(),
        phone: phone.trim(),
        use_case: useCase
      });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Something went wrong. Please try again.');
    }
  };

  const sphereState =
    status === 'loading'
      ? 'loading'
      : status === 'success'
        ? 'success'
        : status === 'error'
          ? 'error'
          : 'idle';

  return (
    <section id="demo" className="dc-demo">
      <h2 className="dc-demo-title">
        Try Our
        <br />
        Live Demo
      </h2>

      <div className="dc-demo-grid">
        <div className="dc-demo-card dc-demo-card-visual">
          <ParticleSphere impulseToken={activeIndex} agentState={sphereState} />
          <div className="dc-persona-pills">
            {USE_CASES.map((uc, i) => (
              <button
                key={uc.id}
                type="button"
                className={`dc-pill dc-pill--${uc.tier}${activeIndex === i ? ' dc-pill-active' : ''}`}
                onClick={() => selectUseCase(uc.id, i)}
              >
                <span className="dc-pill__icon" aria-hidden="true">
                  <CapIcon name={uc.icon} />
                </span>
                {uc.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dc-demo-card dc-demo-card-form">
          <p className="dc-demo-lead">
            Receive a live call from our AI front desk — tailored to dental, medical, specialty, and billing workflows.
          </p>

          {status === 'success' ? (
            <div className="dc-alert dc-alert-success">
              <strong>Calling you now!</strong>
              <p>Answer your phone — you should hear our AI demo agent shortly.</p>
              <a href={signupUrl()} className="dc-btn dc-btn-navy">
                Sign up for Somo
              </a>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="dc-form">
              <label className="dc-field dc-field-underline">
                <span className="dc-label">Practice type</span>
                <select
                  value={useCase}
                  onChange={(e) => {
                    const id = e.target.value;
                    const idx = USE_CASES.findIndex((uc) => uc.id === id);
                    selectUseCase(id, idx);
                  }}
                  disabled={status === 'loading'}
                  required
                >
                  <option value="">Select your practice type</option>
                  {USE_CASES.map((uc) => (
                    <option key={uc.id} value={uc.id}>
                      {uc.label}
                    </option>
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
                  Somo may text me a signup link at this same number (message and data rates may apply).
                </span>
              </label>

              {error && (
                <p className="dc-alert dc-alert-error" role="alert">
                  {error}
                </p>
              )}

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
