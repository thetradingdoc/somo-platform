import { useFocusTrap } from '../../lib/useFocusTrap.js';
import BtnPrimary from '../brand/BtnPrimary.jsx';
import BtnSecondary from '../brand/BtnSecondary.jsx';

export default function IntakeSummarySheet({ open, chips, notes, onConfirm, onCancel }) {
  const trapRef = useFocusTrap(open, onCancel);

  if (!open) return null;

  return (
    <div className="hv-sheet-backdrop" role="presentation">
      <div
        ref={trapRef}
        className="hv-sheet hv-intake-summary"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-summary-title"
      >
        <div className="hv-sheet-handle" />
        <h3 id="intake-summary-title" className="hv-sheet-title">Ready for your summary?</h3>
        <p className="hv-sheet-sub">
          Kelly will prepare a plain-language report from what you shared.
        </p>
        {chips?.length > 0 && (
          <div className="hv-summary-chips" aria-label="Topics discussed">
            {chips.map((chip) => (
              <span key={chip} className="hv-chip">{chip}</span>
            ))}
          </div>
        )}
        {notes?.length > 0 && (
          <ul className="hv-intake-notes-preview">
            {notes.slice(0, 4).map((n) => (
              <li key={`${n.label}-${n.value}`}>
                <strong>{n.label}:</strong> {n.value}
              </li>
            ))}
          </ul>
        )}
        <BtnPrimary onClick={onConfirm}>Get my summary →</BtnPrimary>
        <BtnSecondary onClick={onCancel}>Keep talking to Kelly</BtnSecondary>
      </div>
    </div>
  );
}
