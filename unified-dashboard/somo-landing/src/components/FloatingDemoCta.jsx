import { useEffect, useState } from 'react';

export default function FloatingDemoCta() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const hero = document.querySelector('.somo-hero');
    const demo = document.getElementById('demo');
    const footer = document.querySelector('.somo-footer');
    if (!window.IntersectionObserver) {
      setHidden(false);
      return undefined;
    }

    let heroVisible = true;
    let demoVisible = false;
    let footerVisible = false;

    const update = () => setHidden(heroVisible || demoVisible || footerVisible);

    const observers = [];

    if (hero) {
      const heroObs = new IntersectionObserver(
        ([entry]) => {
          heroVisible = entry.isIntersecting;
          update();
        },
        { threshold: 0.2 }
      );
      heroObs.observe(hero);
      observers.push(heroObs);
    } else {
      heroVisible = false;
    }

    if (demo) {
      const demoObs = new IntersectionObserver(
        ([entry]) => {
          demoVisible = entry.isIntersecting;
          update();
        },
        { threshold: 0.15 }
      );
      demoObs.observe(demo);
      observers.push(demoObs);
    }

    if (footer) {
      const footerObs = new IntersectionObserver(
        ([entry]) => {
          footerVisible = entry.isIntersecting;
          update();
        },
        { threshold: 0.12 }
      );
      footerObs.observe(footer);
      observers.push(footerObs);
    }

    update();

    return () => observers.forEach((obs) => obs.disconnect());
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
