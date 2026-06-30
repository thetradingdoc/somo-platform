export const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English', native: 'English', locale: 'en', reply: 'en' },
  { id: 'sw', label: 'Swahili', native: 'Kiswahili', locale: 'sw', reply: 'sw' },
  { id: 'fr', label: 'French', native: 'Français', locale: 'fr', reply: 'fr' },
  { id: 'es', label: 'Spanish', native: 'Español', locale: 'es', reply: 'es' }
];

export default function LanguageGrid({ value, onChange }) {
  return (
    <div className="hv-lang-grid" role="radiogroup" aria-label="Choose your language">
      {LANGUAGE_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          className={`hv-lang-btn ${value === opt.id ? 'active' : ''}`}
          onClick={() => onChange(opt.id)}
        >
          <div className="hv-lang-name">{opt.label}</div>
          <div className="hv-lang-native">{opt.native}</div>
        </button>
      ))}
    </div>
  );
}

export function resolveLanguage(id) {
  return LANGUAGE_OPTIONS.find((o) => o.id === id) || LANGUAGE_OPTIONS[0];
}
