import { useEffect, useState } from 'react';

export default function FloatingDemoCta() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = document.getElementById('demo');
    if (!el || !window.IntersectionObserver) return undefined;
    const obs = new IntersectionObserver(
      ([entry]) => setHidden(entry.isIntersecting),
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const scrollToDemo = (e) => {
    e.preventDefault();
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  if (hidden) return null;

  return (
    <a href="#demo" className="dc-floating-demo" onClick={scrollToDemo} aria-label="Try our live demo">
      <span className="dc-floating-demo-text">Try Our Live Demo</span>
      <span className="dc-floating-demo-orb" aria-hidden="true" />
    </a>
  );
}
