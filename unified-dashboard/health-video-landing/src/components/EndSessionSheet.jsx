import { useState, useEffect } from 'react';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import BtnPrimary from './brand/BtnPrimary.jsx';
import BtnSecondary from './brand/BtnSecondary.jsx';

const CHECKLIST = [
  'Reviewing your symptoms',
  'Checking for urgent concerns',
  'Preparing your summary'
];

export default function EndSessionSheet({ open, loading, chips = [], onConfirm, onCancel }) {
  const [checkIdx, setCheckIdx] = useState(0);
  const trapRef = useFocusTrap(open, () => !loading && onCancel?.());

  useEffect(() => {
    if (!loading) {
      setCheckIdx(0);
      return undefined;
    }
    const t = setInterval(() => {
      setCheckIdx((i) => Math.min(i + 1, CHECKLIST.length - 1));
    }, 500);
    return () => clearInterval(t);
  }, [loading]);

  if (!open) return null;

  return (
    <div className="hv-end-sheet-backdrop" role="presentation">
      <div
        ref={trapRef}
        className="hv-end-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-sheet-title"
      >
        <div className="hv-sheet-handle" />
        <h3 id="end-sheet-title" className="hv-sheet-title">
          {loading ? 'Generating your summary…' : 'End your health chat?'}
        </h3>
        <p className="hv-sheet-sub">
          {loading
            ? 'Somo is preparing your session report. This may take a few seconds.'
            : 'Somo will generate a plain-language summary you can read, share, or send to a clinic.'}
        </p>
        {loading && (
          <ul className="hv-end-checklist" aria-live="polite">
            {CHECKLIST.map((item, i) => (
              <li key={item} className={i <= checkIdx ? 'done' : ''}>
                <span className="hv-end-check" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        )}
        {!loading && chips.length > 0 && (
          <>
            <div className="hv-sheet-section-label">Topics discussed</div>
            <div className="hv-summary-chips" aria-label="Topics discussed">
              {chips.map((chip) => (
                <span key={chip} className="hv-chip">{chip}</span>
              ))}
            </div>
          </>
        )}
        {!loading && (
          <>
            <BtnPrimary className="hv-end-sheet-primary" onClick={onConfirm}>
              End chat + get summary →
            </BtnPrimary>
            <BtnSecondary onClick={onCancel}>Keep talking to Somo</BtnSecondary>
          </>
        )}
      </div>
    </div>
  );
}
