import { signupUrl } from '../api/somoDemo';

/** Demo-call API retired — CTA points to signup only (Option A). */
export default function DemoSection({ selectedUseCase = '', onUseCaseChange }) {
  void selectedUseCase;
  void onUseCaseChange;

  return (
    <section id="demo" className="dc-demo">
      <h2 className="dc-demo-title">
        Start with
        <br />
        Somo
      </h2>
      <div className="dc-demo-grid">
        <div className="dc-demo-card dc-demo-card-form" style={{ maxWidth: '640px', margin: '0 auto' }}>
          <p className="dc-demo-lead">
            Live demo calls from the landing page are retired. Create your free trial account and configure Kelly
            for your practice in minutes.
          </p>
          <p className="dc-field-helper">
            Questions? Call Somo at <strong>+1 (363) 999-0205</strong> — our platform support line.
          </p>
          <a href={signupUrl()} className="dc-btn dc-btn-primary" style={{ display: 'inline-block', marginTop: '1.5rem' }}>
            Start free trial
          </a>
        </div>
      </div>
    </section>
  );
}
