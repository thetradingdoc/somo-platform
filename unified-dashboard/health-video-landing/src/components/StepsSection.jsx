function IconMic() {
  return (
    <svg className="hv-step-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="18" y="8" width="12" height="22" rx="6" stroke="currentColor" strokeWidth="2" />
      <path d="M12 22c0 8 6 12 12 12s12-4 12-12" stroke="currentColor" strokeWidth="2" />
      <line x1="24" y1="34" x2="24" y2="42" stroke="currentColor" strokeWidth="2" />
      <line x1="16" y1="42" x2="32" y2="42" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg className="hv-step-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <ellipse cx="24" cy="22" rx="14" ry="16" stroke="currentColor" strokeWidth="2" />
      <circle cx="24" cy="20" r="5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 38h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconReport() {
  return (
    <svg className="hv-step-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M14 8h14l8 8v28H14V8z" stroke="currentColor" strokeWidth="2" />
      <path d="M28 8v8h8" stroke="currentColor" strokeWidth="2" />
      <path d="M18 24h16M18 30h12M18 36h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="36" r="4" fill="currentColor" />
    </svg>
  );
}

const STEPS = [
  { icon: IconMic, title: 'Talk naturally', desc: 'Describe symptoms in your own words — Somo listens and asks follow-ups.' },
  { icon: IconCamera, title: 'Show on camera when asked', desc: 'Somo may ask you to position the camera for skin or body concerns.' },
  { icon: IconReport, title: 'Get a plain-language summary', desc: 'End your session and receive an educational summary to share or save.' }
];

export default function StepsSection() {
  return (
    <div className="hv-steps">
      {STEPS.map(({ icon: Icon, title, desc }) => (
        <div key={title} className="hv-step-card">
          <Icon />
          <p className="hv-step-title">{title}</p>
          <p className="hv-step-desc">{desc}</p>
        </div>
      ))}
    </div>
  );
}
