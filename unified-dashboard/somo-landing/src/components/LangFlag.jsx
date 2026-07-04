const FLAGS = {
  gb: (
    <svg viewBox="0 0 60 40" aria-hidden="true" className="somo-lang-flag-svg">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0l60 40M60 0L0 40" stroke="#fff" strokeWidth="8" />
      <path d="M0 0l60 40M60 0L0 40" stroke="#C8102E" strokeWidth="4" />
      <path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="12" />
      <path d="M30 0v40M0 20h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  ),
  es: (
    <svg viewBox="0 0 60 40" aria-hidden="true" className="somo-lang-flag-svg">
      <rect width="60" height="40" fill="#AA151B" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </svg>
  ),
  fr: (
    <svg viewBox="0 0 60 40" aria-hidden="true" className="somo-lang-flag-svg">
      <rect width="20" height="40" fill="#002395" />
      <rect x="20" width="20" height="40" fill="#fff" />
      <rect x="40" width="20" height="40" fill="#ED2939" />
    </svg>
  ),
  de: (
    <svg viewBox="0 0 60 40" aria-hidden="true" className="somo-lang-flag-svg">
      <rect width="60" height="13.33" fill="#000" />
      <rect y="13.33" width="60" height="13.33" fill="#DD0000" />
      <rect y="26.66" width="60" height="13.34" fill="#FFCE00" />
    </svg>
  ),
  ru: (
    <svg viewBox="0 0 60 40" aria-hidden="true" className="somo-lang-flag-svg">
      <rect width="60" height="13.33" fill="#fff" />
      <rect y="13.33" width="60" height="13.33" fill="#0039A6" />
      <rect y="26.66" width="60" height="13.34" fill="#D52B1E" />
    </svg>
  ),
  cn: (
    <svg viewBox="0 0 60 40" aria-hidden="true" className="somo-lang-flag-svg">
      <rect width="60" height="40" fill="#DE2910" />
      <polygon
        points="12,8 13.8,13.2 19.4,13.2 14.8,16.4 16.6,21.6 12,18.4 7.4,21.6 9.2,16.4 4.6,13.2 10.2,13.2"
        fill="#FFDE00"
      />
      <circle cx="22" cy="8" r="1.4" fill="#FFDE00" />
      <circle cx="24.5" cy="11" r="1.4" fill="#FFDE00" />
      <circle cx="24.5" cy="15" r="1.4" fill="#FFDE00" />
      <circle cx="22" cy="18" r="1.4" fill="#FFDE00" />
    </svg>
  )
};

export default function LangFlag({ code }) {
  return FLAGS[code] || null;
}
