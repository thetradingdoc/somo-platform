import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JourneyShell from '../components/journey/JourneyShell.jsx';
import StepIndicator from '../components/journey/StepIndicator.jsx';
import BtnPrimary from '../components/brand/BtnPrimary.jsx';
import { updateJourney } from '../lib/healthStorage.js';
import { useJourneyGuard } from '../lib/useJourneyGuard.js';

const AGE_RANGES = [
  'Under 18',
  '18 – 35',
  '36 – 55',
  '56 – 70',
  'Over 70'
];

export default function NamePage() {
  const navigate = useNavigate();
  useJourneyGuard(false);
  const [displayName, setDisplayName] = useState('');
  const [ageRange, setAgeRange] = useState('18 – 35');

  const goPrivacy = (withFields) => {
    if (withFields) {
      updateJourney({
        display_name: displayName.trim() || undefined,
        age_range: ageRange
      });
    }
    navigate('/privacy');
  };

  return (
    <JourneyShell onBack={() => navigate('/start')}>
      <StepIndicator step={2} />
      <h2 className="hv-step-title">What should Kelly call you?</h2>
      <p className="hv-step-sub">
        This is optional. Kelly is here to help you — not to know who you are.
      </p>

      <label className="hv-field-label" htmlFor="displayName">Your first name (optional)</label>
      <input
        id="displayName"
        className="hv-field-input"
        type="text"
        placeholder="e.g. Amina"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        autoComplete="given-name"
      />

      <label className="hv-field-label" htmlFor="ageRange">Age range (helps Kelly give better guidance)</label>
      <select
        id="ageRange"
        className="hv-field-input"
        value={ageRange}
        onChange={(e) => setAgeRange(e.target.value)}
      >
        {AGE_RANGES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      <div className="hv-journey-spacer" />

      <BtnPrimary onClick={() => goPrivacy(true)}>Continue →</BtnPrimary>
      <button type="button" className="hv-skip-link" onClick={() => goPrivacy(false)}>
        Skip — stay anonymous
      </button>
    </JourneyShell>
  );
}
