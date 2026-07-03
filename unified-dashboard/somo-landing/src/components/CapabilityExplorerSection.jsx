import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAPABILITIES,
  CAPABILITIES_SECTION,
  capabilitiesJsonLd
} from '../content/landingContent';
import CapIcon from './CapIcon';

export default function CapabilityExplorerSection() {
  const [activeId, setActiveId] = useState(CAPABILITIES[0].id);
  const optionsRef = useRef(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'somo-capabilities-schema';
    script.textContent = JSON.stringify(capabilitiesJsonLd());
    document.head.appendChild(script);
    return () => {
      document.getElementById('somo-capabilities-schema')?.remove();
    };
  }, []);

  const onKeyDown = useCallback((e, index) => {
    const lastIndex = CAPABILITIES.length - 1;
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
    setActiveId(CAPABILITIES[next].id);
    optionsRef.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  }, []);

  return (
    <section id="capabilities" className="somo-section somo-capabilities" aria-labelledby="capabilities-title">
      <div className="somo-section-inner">
        <h2 id="capabilities-title" className="somo-section-title">
          <span className="somo-cap-title-accent">{CAPABILITIES_SECTION.titleAccent}</span>
          {CAPABILITIES_SECTION.titleSuffix}
        </h2>
        <p className="somo-section-lead">{CAPABILITIES_SECTION.lead}</p>

        <div className="somo-cap-options" role="tablist" aria-label="Somo capabilities" ref={optionsRef}>
          {CAPABILITIES.map((cap, i) => {
            const isActive = activeId === cap.id;
            return (
              <button
                key={cap.id}
                type="button"
                role="tab"
                id={`cap-tab-${cap.id}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`somo-cap-option${isActive ? ' is-active' : ''}`}
                style={{
                  '--cap-surface': cap.cardSurface,
                  '--cap-border': cap.cardBorder,
                  '--cap-rail': cap.accentRail,
                  '--cap-accent': cap.accentColor
                }}
                onClick={() => setActiveId(cap.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                <span className="somo-cap-option__collapsed" aria-hidden={isActive}>
                  <span className="somo-cap-option__collapsed-icon">
                    <CapIcon name={cap.icon} />
                  </span>
                  <span className="somo-cap-option__collapsed-label">{cap.tabLabel ?? cap.label}</span>
                </span>

                <span className="somo-cap-option__rail" aria-hidden={!isActive}>
                  <span className="somo-cap-option__rail-icon">
                    <CapIcon name={cap.icon} />
                  </span>
                </span>

                <span className="somo-cap-option__panel">
                  <span className="somo-cap-option__panel-header">
                    <span className="somo-cap-option__panel-label">{cap.label}</span>
                  </span>
                  <span className="somo-cap-option__panel-divider" aria-hidden="true" />
                  <span className="somo-cap-option__panel-title">{cap.seoTitle}</span>
                  <p className="somo-cap-option__panel-body">{cap.body}</p>
                  <ul className="somo-cap-option__bullets">
                    {cap.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
