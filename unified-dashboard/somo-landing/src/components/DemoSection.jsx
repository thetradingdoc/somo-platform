import { useEffect, useRef, useState } from 'react';
import { USE_CASES, requestDemoCall, saveSignupPrefill } from '../api/somoDemo';
import CapIcon from './CapIcon';
import ParticleSphere from './ParticleSphere';

export default function DemoSection({ selectedUseCase = '', onUseCaseChange }) {
  const [useCase, setUseCase] = useState(selectedUseCase);
  const [practiceSpecialty, setPracticeSpecialty] = useState('');
  const [questionsAsked, setQuestionsAsked] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef(null);
  const turnstileSiteKey = import.meta.env.VITE_SOMO_DEMO_TURNSTILE_SITE_KEY || '';

  useEffect(() => {
    if (!turnstileSiteKey || status !== 'idle') return;
    const mountTurnstile = () => {
      if (!turnstileRef.current || !window.turnstile) return;
      window.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken('')
      });
    };
    if (window.turnstile) {
      mountTurnstile();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = mountTurnstile;
    document.head.appendChild(script);
  }, [turnstileSiteKey, status]);

  useEffect(() => {
    if (!selectedUseCase) return;
    if (!USE_CASES.some((uc) => uc.id === selectedUseCase)) return;
    setUseCase(selectedUseCase);
    const idx = USE_CASES.findIndex((uc) => uc.id === selectedUseCase);
    if (idx >= 0) setActiveIndex(idx);
  }, [selectedUseCase]);

  const selectUseCase = (id, index) => {
    setUseCase(id);
    setActiveIndex(index);
    onUseCaseChange?.(id);
    if (id !== 'specialty_practice') setPracticeSpecialty('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!consent) {
      setError('Please agree to receive a one-time demo call.');
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError('Please complete the security check.');
      return;
    }
    setStatus('loading');
    try {
      await requestDemoCall({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        use_case: useCase || undefined,
        practice_specialty:
          useCase === 'specialty_practice' ? practiceSpecialty.trim() || undefined : undefined,
        questions_asked: questionsAsked.trim() || undefined,
        consent: true,
        turnstile_token: turnstileToken || undefined
      });
      saveSignupPrefill({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        use_case: useCase,
        practice_specialty: practiceSpecialty.trim()
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
          <p className="dc-pill-group-label">Practice type</p>
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
          <p className="dc-pill-group-helper">
            Choose your practice type to tailor the call—or skip and we&apos;ll ask live.
          </p>
          {useCase === 'specialty_practice' && (
            <label className="dc-field dc-field-underline dc-field-visual">
              <span className="dc-label">Specialty</span>
              <input
                type="text"
                maxLength={120}
                placeholder="e.g. Dermatology"
                value={practiceSpecialty}
                onChange={(e) => setPracticeSpecialty(e.target.value)}
                disabled={status === 'loading'}
              />
            </label>
          )}
        </div>

        <div className="dc-demo-card dc-demo-card-form">
          <p className="dc-demo-lead">
            Get a <strong>2-minute live call</strong> from Somo&apos;s AI front desk. We&apos;ll learn how your
            practice runs—no sales pitch.
          </p>

          {status === 'success' ? (
            <div className="dc-alert dc-alert-success">
              <strong>Calling you now!</strong>
              <p>
                Answer your phone — Somo&apos;s front desk will ask a few quick questions (~2 minutes).
                {email.trim() ? ' We also sent a confirmation to your email.' : ''}
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="dc-form">
              <label className="dc-field dc-field-underline">
                <span className="dc-label" id="demo-name-label">
                  Your name
                </span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  aria-labelledby="demo-name-label"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={status === 'loading'}
                />
              </label>

              <label className="dc-field dc-field-underline">
                <span className="dc-label" id="demo-email-label">
                  Work email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  aria-labelledby="demo-email-label"
                  placeholder="you@practice.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'loading'}
                />
              </label>

              <label className="dc-field dc-field-underline">
                <span className="dc-label" id="demo-phone-label">
                  Mobile number
                </span>
                <input
                  type="tel"
                  required
                  autoComplete="tel"
                  aria-labelledby="demo-phone-label"
                  aria-describedby="demo-phone-helper"
                  placeholder="+1 555 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={status === 'loading'}
                />
                <span className="dc-field-helper" id="demo-phone-helper">
                  Include country code, e.g. +1 555 123 4567
                </span>
              </label>

              <label className="dc-field dc-field-underline">
                <span className="dc-label" id="demo-note-label">
                  What do you need help with ?
                </span>
                <input
                  type="text"
                  maxLength={500}
                  aria-labelledby="demo-note-label"
                  aria-describedby="demo-note-helper"
                  placeholder="After-hours coverage, bilingual patients…"
                  value={questionsAsked}
                  onChange={(e) => setQuestionsAsked(e.target.value)}
                  disabled={status === 'loading'}
                />
                <span className="dc-field-helper" id="demo-note-helper">
                  One sentence is enough—we&apos;ll ask more on the call.
                </span>
              </label>

              <label className="dc-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={status === 'loading'}
                />
                <span>
                  I agree to receive a one-time automated demo call at the number above and occasional
                  product email at the address provided. Somo may email you a signup link if you ask
                  during the call.
                </span>
              </label>

              {turnstileSiteKey ? <div ref={turnstileRef} className="dc-turnstile" /> : null}

              {error && (
                <p className="dc-alert dc-alert-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="dc-btn dc-btn-primary" disabled={status === 'loading'}>
                {status === 'loading' ? 'Calling you now…' : 'Get my demo call'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
