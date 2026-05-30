import { LANGUAGES, LANGUAGES_SECTION_NOTE } from '../content/landingContent';
import LangFlag from './LangFlag';

export default function HipaaLangSection() {
  return (
    <section id="languages" className="somo-section somo-languages" aria-labelledby="languages-title">
      <div className="somo-section-inner somo-languages-inner">
        <h2 id="languages-title" className="somo-section-title">
          Speaks your patients&apos; language
        </h2>
        <p className="somo-section-lead">
          Somo detects the caller&apos;s language automatically — no press-1-for-Spanish menus.
        </p>
        <div className="somo-lang-grid">
          {LANGUAGES.map((lang) => (
            <span key={lang.label} className="somo-lang-cell">
              <span className="somo-lang-cell__flag" aria-hidden="true">
                <LangFlag code={lang.flagCode} />
              </span>
              <span className="somo-lang-cell__label">{lang.label}</span>
            </span>
          ))}
        </div>
        <span className="somo-lang-more">
          <span className="somo-lang-more__flag somo-lang-more__flag--globe" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="somo-lang-flag-svg" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9M12 3C9.5 5.8 8.2 8.8 8.2 12s1.3 6.2 3.8 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </span>
          + more
        </span>
        <p className="somo-languages-note">{LANGUAGES_SECTION_NOTE}</p>
      </div>
    </section>
  );
}
