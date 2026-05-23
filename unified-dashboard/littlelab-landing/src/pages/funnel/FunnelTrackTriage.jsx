import React, { useState } from 'react';
import {
  getConcernChips,
  getInquiry,
  getUserGoal,
  setClarifyAnswers,
  setConcernChips,
  setInquiry,
} from '../../lib/funnelSession';
import FunnelConcernPicker from './FunnelConcernPicker';

const MIN_INQUIRY_LEN = 8;

export default function FunnelTrackTriage({ onCaptureComplete, onBack, onError }) {
  const [inquiry, setInquiryState] = useState(() => getInquiry());
  const [selectedChips, setSelectedChips] = useState(() => getConcernChips());
  const [notSureMode, setNotSureMode] = useState(false);

  function toggleChip(id) {
    setNotSureMode(false);
    setSelectedChips((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      setConcernChips(next);
      return next;
    });
  }

  function handleNotSure() {
    setNotSureMode(true);
    setSelectedChips([]);
    setConcernChips([]);
    setClarifyAnswers(null);
  }

  function handleContinue() {
    const text = String(inquiry || '').trim();
    setInquiry(text);
    onError?.('');
    if (notSureMode) {
      if (text.length < MIN_INQUIRY_LEN) {
        onError?.('Add a few words about what is going on (at least 8 characters).');
        return;
      }
      onCaptureComplete?.({ concern_chips: [], inquiry: text, not_sure: true });
      return;
    }
    if (selectedChips.length === 0 && text.length < MIN_INQUIRY_LEN) {
      onError?.('Select at least one concern, or describe what is going on.');
      return;
    }
    onCaptureComplete?.({
      concern_chips: selectedChips,
      inquiry: text,
      not_sure: false,
    });
  }

  const canContinue =
    notSureMode
      ? String(inquiry || '').trim().length >= MIN_INQUIRY_LEN
      : selectedChips.length > 0 || String(inquiry || '').trim().length >= MIN_INQUIRY_LEN;
  const isFindSpecialist = getUserGoal() === 'find_specialist';

  return (
    <div className="funnel-match-wrap funnel-triage-wrap">
      <div className="funnel-card funnel-card--age funnel-triage-section">
        <p className="funnel-triage-kicker">What&apos;s going on</p>
        <p className="funnel-photo-honest">
          {isFindSpecialist
            ? 'Select all that apply, or describe in your own words. Kelly checks for anything that needs a clinician before we search for specialists near you — not a diagnosis from your photo.'
            : 'Select all that apply, or choose Not sure and describe in your own words. We use Kelly and clinical triage to recommend one starting program — not a diagnosis from your photo.'}
        </p>
        <FunnelConcernPicker
          selectedIds={selectedChips}
          onToggle={toggleChip}
          onNotSure={handleNotSure}
        />
      </div>

      <div className="funnel-card funnel-card--age funnel-triage-section funnel-triage-detail">
        <label htmlFor="funnel-inquiry-detail" className="funnel-age-field-label">
          {notSureMode ? 'Describe what is going on' : 'Add a few words'}{' '}
          <span className="funnel-optional">{notSureMode ? '' : '(optional)'}</span>
        </label>
        <textarea
          id="funnel-inquiry-detail"
          className="funnel-input funnel-input--inquiry"
          rows={3}
          placeholder={
            notSureMode
              ? 'e.g. redness on cheeks plus occasional breakouts for months'
              : 'e.g. painful cystic acne, dark spots after breakouts'
          }
          value={inquiry}
          onChange={(e) => setInquiryState(e.target.value)}
        />
        <div className={`funnel-card-actions${onBack ? ' funnel-card-actions--stacked' : ''}`}>
          <button
            type="button"
            className="funnel-btn"
            disabled={!canContinue}
            onClick={handleContinue}
          >
            Continue
          </button>
          {onBack ? (
            <button type="button" className="funnel-btn funnel-btn-secondary" onClick={onBack}>
              Back
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
