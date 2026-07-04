import { useCallback, useEffect, useState } from 'react';
import {
  HOW_IT_WORKS,
  HOW_IT_WORKS_SECTION,
  howItWorksJsonLd
} from '../content/landingContent';

export default function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0);
  const lastIndex = HOW_IT_WORKS.length - 1;
  const fillPercent = lastIndex > 0 ? (activeStep / lastIndex) * 100 : 0;
  const geckoLeft = lastIndex > 0 ? (activeStep / lastIndex) * 100 : 0;

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'somo-how-it-works-schema';
    script.textContent = JSON.stringify(howItWorksJsonLd());
    document.head.appendChild(script);
    return () => {
      document.getElementById('somo-how-it-works-schema')?.remove();
    };
  }, []);

  const onStepKeyDown = useCallback((e, index) => {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = Math.min(index + 1, lastIndex);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = Math.max(index - 1, 0);
    } else if (e.key === 'Home') {
      e.preventDefault();
      next = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      next = lastIndex;
    } else {
      return;
    }
    setActiveStep(next);
    e.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus();
  }, [lastIndex]);

  return (
    <section id="how-it-works" className="somo-section somo-how" aria-labelledby="how-it-works-title">
      <div className="somo-section-inner somo-how-inner">
        <h2 id="how-it-works-title" className="somo-section-title">
          {HOW_IT_WORKS_SECTION.title}
        </h2>
        <p className="somo-section-lead">{HOW_IT_WORKS_SECTION.lead}</p>

        <div className="somo-how-progress">
          <div className="somo-how-progress__bar-wrap" aria-hidden="true">
            <img
              src="/assets/brand/somo-gecko.svg"
              alt=""
              className="somo-how-gecko"
              style={{ left: `${geckoLeft}%` }}
            />
            <div className="somo-how-progress__bar-track" />
            <div className="somo-how-progress__bar-fill" style={{ width: `${fillPercent}%` }} />
          </div>

          <div className="somo-how-progress__steps" role="tablist" aria-label="How Somo works">
            {HOW_IT_WORKS.map((step, index) => {
              const isActive = index === activeStep;
              const isComplete = index < activeStep;
              return (
                <button
                  key={step.step}
                  type="button"
                  role="tab"
                  id={`how-tab-${step.step}`}
                  aria-selected={isActive}
                  aria-controls={`how-panel-${step.step}`}
                  tabIndex={isActive ? 0 : -1}
                  className={`somo-how-progress__step ${isActive ? 'is-active' : ''} ${isComplete ? 'is-complete' : ''}`}
                  onClick={() => setActiveStep(index)}
                  onKeyDown={(e) => onStepKeyDown(e, index)}
                >
                  <span className="somo-how-progress__dot">{isComplete ? '✓' : step.step}</span>
                  <span className="somo-how-progress__label">{step.tabLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="somo-how-progress__panels">
            {HOW_IT_WORKS.map((step, index) => (
              <article
                key={step.step}
                id={`how-panel-${step.step}`}
                role="tabpanel"
                aria-labelledby={`how-tab-${step.step}`}
                aria-hidden={index !== activeStep}
                data-step={step.step}
                data-theme={step.panelTheme}
                className={`somo-how-progress__panel ${index === activeStep ? 'is-active' : ''}`}
              >
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
