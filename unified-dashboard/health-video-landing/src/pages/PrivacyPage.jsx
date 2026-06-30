import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LockClosedIcon,
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';
import JourneyShell, { EmergencyFooter } from '../components/journey/JourneyShell.jsx';
import StepIndicator from '../components/journey/StepIndicator.jsx';
import BtnPrimary from '../components/brand/BtnPrimary.jsx';
import { getJourney, setPhotoAnalysisConsent } from '../lib/healthStorage.js';
import { startSession } from '../lib/healthSessionApi.js';
import { useHealthSession } from '../lib/HealthSessionContext.jsx';
import { useJourneyGuard } from '../lib/useJourneyGuard.js';

export default function PrivacyPage() {
  const navigate = useNavigate();
  useJourneyGuard(false);
  const { setSession } = useHealthSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleContinue = async () => {
    const journey = getJourney();
    if (!journey?.terms_accepted) {
      navigate('/start', { replace: true });
      return;
    }
    setLoading(true);
    setError('');
    try {
      setPhotoAnalysisConsent(journey.terms_version);
      const metadata = {};
      if (journey.age_range) metadata.age_range = journey.age_range;
      const data = await startSession({
        terms_accepted: true,
        locale: journey.locale,
        reply_language: journey.reply_language,
        terms_version: journey.terms_version,
        display_name: journey.display_name,
        metadata
      });
      setSession({
        sessionId: data.session.id,
        sessionToken: data.session_token,
        sseToken: data.sse_token,
        sseUrl: data.sse_url,
        livekit: data.livekit,
        locale: journey.locale,
        replyLanguage: journey.reply_language,
        displayName: journey.display_name,
        roomId: data.session.room_id
      });
      navigate('/session');
    } catch (e) {
      setError(e.message || 'Could not start session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <JourneyShell onBack={() => navigate('/name')} footer={<EmergencyFooter />}>
      <StepIndicator step={3} />
      <h2 className="hv-step-title">Before we start</h2>
      <p className="hv-step-sub" style={{ marginBottom: 16 }}>
        Somo is a safe space. Here is how we protect you.
      </p>

      <div className="hv-privacy-card">
        <div className="hv-privacy-icon" aria-hidden="true">
          <LockClosedIcon className="hv-icon hv-icon--md" />
        </div>
        <div className="hv-privacy-text">
          <h3>Private by design</h3>
          <p>Your conversation is not linked to your identity. No one outside this session can read it.</p>
        </div>
      </div>

      <div className="hv-privacy-card">
        <div className="hv-privacy-icon" aria-hidden="true">
          <ChatBubbleLeftRightIcon className="hv-icon hv-icon--md" />
        </div>
        <div className="hv-privacy-text">
          <h3>You can say anything</h3>
          <p>
            Somo can help with sensitive topics — skin concerns, reproductive health, pain in private areas.
            Speak openly.
          </p>
        </div>
      </div>

      <div className="hv-sensitive-banner">
        <div className="hv-sensitive-icon" aria-hidden="true">
          <ShieldCheckIcon className="hv-icon hv-icon--md" />
        </div>
        <div className="hv-sensitive-text">
          <strong>For sensitive body concerns:</strong> Somo will never ask you to show a private area on
          camera without your explicit consent. You can always just describe it in words.
        </div>
      </div>

      <div className="hv-journey-spacer" />

      <BtnPrimary onClick={handleContinue} disabled={loading}>
        {loading ? 'Starting…' : 'I understand — call Somo →'}
      </BtnPrimary>
      {error && <p className="hv-error">{error}</p>}
      <p className="hv-emergency-line" style={{ marginTop: 12 }}>
        Not for emergencies. Call local services if urgent.
      </p>
    </JourneyShell>
  );
}
