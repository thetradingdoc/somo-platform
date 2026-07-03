import { ROI_NEW_WAY, ROI_OLD_WAY, ROI_SAVINGS } from '../content/landingContent';
import RoiRowIcon from './RoiRowIcon';

function RoiWayCard({ variant, data }) {
  const isOld = variant === 'old';
  return (
    <article className={`somo-roi-way somo-roi-way--${variant}`}>
      <span className="somo-roi-way__badge">{data.badge}</span>
      <h3 className="somo-roi-way__title">
        {isOld ? (
          data.title
        ) : (
          <>
            {data.title} <span className="somo-roi-way__title-accent">{data.titleAccent}</span>
          </>
        )}
      </h3>
      <ul className="somo-roi-way__list">
        {data.items.map((item, index) => (
          <li key={item.title} className="somo-roi-way__item">
            {index > 0 && <span className="somo-roi-way__divider" aria-hidden="true" />}
            <div className="somo-roi-way__row">
              <span className="somo-roi-way__icon" aria-hidden="true">
                <RoiRowIcon name={item.icon} />
              </span>
              <div className="somo-roi-way__body">
                <p className="somo-roi-way__item-title">{item.title}</p>
                <p className="somo-roi-way__item-sub">{item.sub}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function RoiSection() {
  return (
    <section id="roi" className="somo-section somo-roi">
      <div className="somo-section-inner somo-roi-inner">
        <h2 className="somo-section-title">Replace a $3,500/mo receptionist</h2>
        <p className="somo-section-lead">
          Full-time front desk staff cost salary, benefits, PTO, and sick days. Somo is always on.
        </p>
        <div className="somo-roi-compare">
          <RoiWayCard variant="old" data={ROI_OLD_WAY} />
          <div className="somo-roi-arrow" aria-hidden="true">
            <span className="somo-roi-arrow__circle">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
          <RoiWayCard variant="new" data={ROI_NEW_WAY} />
          <aside className="somo-roi-savings">
            <p className="somo-roi-savings__label">{ROI_SAVINGS.label}</p>
            <p className="somo-roi-savings__amount">{ROI_SAVINGS.amount}</p>
            <p className="somo-roi-savings__unit">{ROI_SAVINGS.unit}</p>
            <p className="somo-roi-savings__sub">{ROI_SAVINGS.sub}</p>
          </aside>
        </div>
        <p className="somo-roi-footnote">
          * $3,500+/mo estimate for a full-time US front desk receptionist (salary + benefits). Somo Practice tier
          from plan catalog. Savings vary by market and call volume.
        </p>
      </div>
    </section>
  );
}
