import { useEffect, useState } from 'react';
import { FAQ_ITEMS, faqJsonLd } from '../content/landingContent';

export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'somo-faq-schema';
    script.textContent = JSON.stringify(faqJsonLd());
    document.head.appendChild(script);
    return () => {
      document.getElementById('somo-faq-schema')?.remove();
    };
  }, []);

  return (
    <section id="faq" className="somo-section somo-faq">
      <div className="somo-section-inner somo-faq-inner">
        <h2 className="somo-section-title">Frequently asked questions</h2>
        <div className="somo-faq-list">
          {FAQ_ITEMS.map((item, i) => {
            const open = openIndex === i;
            return (
              <div key={item.question} className={`somo-faq-item ${open ? 'somo-faq-item-open' : ''}`}>
                <button
                  type="button"
                  className="somo-faq-question"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? null : i)}
                >
                  {item.question}
                  <span className="somo-faq-chevron" aria-hidden="true">
                    {open ? '−' : '+'}
                  </span>
                </button>
                {open && <p className="somo-faq-answer">{item.answer}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
