import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JourneyShell, { EmergencyFooter } from '../components/journey/JourneyShell.jsx';
import StepIndicator from '../components/journey/StepIndicator.jsx';
import LanguageGrid, { resolveLanguage } from '../components/journey/LanguageGrid.jsx';
import BtnPrimary from '../components/brand/BtnPrimary.jsx';
import { saveJourney, TERMS_VERSION } from '../lib/healthStorage.js';

export default function LanguageStartPage() {
  const navigate = useNavigate();
  const [langId, setLangId] = useState('en');

  const handleStart = () => {
    const lang = resolveLanguage(langId);
    saveJourney({
      locale: lang.locale,
      reply_language: lang.reply,
      terms_accepted: true,
      terms_version: TERMS_VERSION
    });
    navigate('/name');
  };

  return (
    <JourneyShell onBack={() => navigate('/')} footer={<EmergencyFooter />}>
      <StepIndicator step={1} />
      <h2 className="hv-step-title">Choose your language</h2>
      <p className="hv-step-sub">
        Somo will speak with you in the language you pick.
      </p>

      <LanguageGrid value={langId} onChange={setLangId} />

      <p className="hv-consent-line hv-consent-line--single">
        By continuing you agree to our{' '}
        <a href="/health-terms.html">terms</a> and{' '}
        <a href="/health-privacy.html">privacy policy</a>.
      </p>

      <BtnPrimary onClick={handleStart} disabled={!langId}>
        Continue →
      </BtnPrimary>
    </JourneyShell>
  );
}
