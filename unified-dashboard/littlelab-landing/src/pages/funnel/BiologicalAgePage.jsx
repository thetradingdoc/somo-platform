import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { faceReadStatus, faceReadUpload, fetchRoutinePreview, postFunnelMatch } from '../../lib/funnelApi';
import {
  getConfirmedAge,
  getConcernId,
  getPreviewCache,
  getMatchResult,
  getFaceRead,
  getInquiry,
  getUserGoal,
  getZip,
  clearMatchDraftState,
  setConfirmedAge,
  setConcernId,
  setConcernChips,
  setClarifyAnswers,
  setFaceRead,
  setFunnelIntakeProposal,
  setInquiry,
  setMatchResult,
  setPreviewCache,
  setUserGoal,
  setSpecialistUpsell,
  setZip,
} from '../../lib/funnelSession';
import FunnelBrandLockup from './FunnelBrandLockup';
import FunnelScOrb from './FunnelScOrb';
import FunnelStepDots from './FunnelStepDots';
import FunnelIntentPicker from './FunnelIntentPicker';
import FunnelMatchInquiry from './FunnelMatchInquiry';
import FunnelKellyMatchGate from './FunnelKellyMatchGate';
import FunnelSpecialistZip from './FunnelSpecialistZip';
import FunnelClarifyQuestions from './FunnelClarifyQuestions';
import FunnelDualOffer from './FunnelDualOffer';
import FunnelProgramPreview from './FunnelProgramPreview';
import FunnelSpecialistList from './FunnelSpecialistList';
import FunnelSaveEmail from './FunnelSaveEmail';
import FunnelDone from './FunnelDone';
import '../../funnel/landing-funnel.css';

const AGE_HEADLINES = {
  capture: { kind: 'plain', text: 'Guess my age' },
  analyzing: { kind: 'split', lead: 'Your', emphasis: 'skin age' },
  confirm: { kind: 'split', lead: 'Your', emphasis: 'skin age' },
  correct: { kind: 'split', lead: 'Your', emphasis: 'actual age' },
};

const VALUE_HEADLINES = {
  intent: { kind: 'split', lead: 'How can we', emphasis: 'help?' },
  match: { kind: 'split', lead: "What's going", emphasis: 'on?' },
  matchFindSpecialist: { kind: 'split', lead: 'Tell us what', emphasis: 'to search' },
  kellyGate: { kind: 'split', lead: 'Confirm your', emphasis: 'match' },
  kellyGateFindSpecialist: { kind: 'split', lead: 'Quick', emphasis: 'safety check' },
  matchUpsell: { kind: 'split', lead: 'Pick a plan to', emphasis: 'track' },
  clarify: { kind: 'plain', text: 'A few quick questions' },
  preview: { kind: 'split', lead: 'Your', emphasis: 'week 1 plan' },
  specialistZip: { kind: 'split', lead: 'Find', emphasis: 'specialists' },
  specialist: { kind: 'split', lead: 'Specialists', emphasis: 'near you' },
  dual: { kind: 'split', lead: 'Track &', emphasis: 'find care' },
  save: { kind: 'plain', text: 'Save this plan' },
  done: { kind: 'plain', text: "You're set" },
};

function FunnelAgeHeadline({ step, userGoal }) {
  let headlineKey = step;
  if (step === 'match' && userGoal === 'both') headlineKey = 'matchUpsell';
  else if (step === 'match' && userGoal === 'find_specialist') headlineKey = 'matchFindSpecialist';
  else if (step === 'kellyGate' && userGoal === 'find_specialist') headlineKey = 'kellyGateFindSpecialist';
  const spec = AGE_HEADLINES[headlineKey] || VALUE_HEADLINES[headlineKey] || AGE_HEADLINES.capture;
  if (spec.kind === 'plain') {
    return <h1 className="funnel-age-headline">{spec.text}</h1>;
  }
  return (
    <h1 className="funnel-age-headline">
      {spec.lead} <em>{spec.emphasis}</em>
    </h1>
  );
}

function sublineForStep(step) {
  if (
    ['intent', 'match', 'kellyGate', 'clarify', 'specialistZip', 'preview', 'specialist', 'dual', 'save', 'done'].includes(
      step,
    )
  ) {
    return 'Wellness guidance only — not medical advice. Certain symptoms need a clinician—we will guide you.';
  }
  return 'Wellness estimate only — not a medical or chronological age diagnosis.';
}

function readE2eFunnelStep() {
  try {
    const p = new URLSearchParams(window.location.search).get('e2e_funnel_step');
    if (
      p &&
      [
        'capture',
        'analyzing',
        'confirm',
        'correct',
        'intent',
        'match',
        'kellyGate',
        'clarify',
        'specialistZip',
        'preview',
        'specialist',
        'dual',
        'save',
        'done',
      ].includes(p)
    ) {
      return p;
    }
  } catch (_) {}
  return 'capture';
}

export default function BiologicalAgePage() {
  const [step, setStep] = useState(readE2eFunnelStep);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState('');
  const [correctAge, setCorrectAge] = useState('');
  const [ready, setReady] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [concernId, setConcernIdState] = useState('');
  const [preview, setPreview] = useState(() => getPreviewCache());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [savedAccount, setSavedAccount] = useState(false);
  const [matchResult, setMatchResultState] = useState(() => getMatchResult());
  const [clarifyHint, setClarifyHint] = useState('');
  const [clarifyQuestions, setClarifyQuestions] = useState([]);
  const [clarifyLoading, setClarifyLoading] = useState(false);
  const [funnelZip, setFunnelZip] = useState('');
  const [capturePayload, setCapturePayload] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const fileCamRef = useRef(null);
  const fileLibRef = useRef(null);

  useEffect(() => {
    faceReadStatus()
      .then((d) => setReady(Boolean(d?.ready)))
      .catch(() => setReady(false));
    return () => {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (step !== 'capture') {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      streamRef.current = null;
      setHasStream(false);
    }
  }, [step]);

  useEffect(() => {
    if (hasStream && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [hasStream]);

  const loadPreview = useCallback(async (id) => {
    setPreviewLoading(true);
    setError('');
    try {
      const data = await fetchRoutinePreview(id);
      setPreview(data);
      setPreviewCache(data);
      setStep('preview');
    } catch (e) {
      setError(e.message || 'Could not load preview');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const onMatchProgram = useCallback(
    (match) => {
      const id = match?.concern_id;
      const full = {
        ...match,
        route: match?.route || 'program',
        concern_id: id,
        secondary_concern_ids: match?.secondary_concern_ids || [],
      };
      setMatchResultState(full);
      setMatchResult(full);
      setClarifyHint('');
      if (!id) return;
      setConcernId(id);
      setConcernIdState(id);
      loadPreview(id);
    },
    [loadPreview],
  );

  const onMatchSpecialist = useCallback((match) => {
    setMatchResultState(match);
    setClarifyHint('');
    setStep('specialist');
  }, []);

  const onMatchClarify = useCallback((match) => {
    setMatchResultState(match);
    setMatchResult(match);
    if (Array.isArray(match?.next_questions) && match.next_questions.length > 0) {
      setClarifyQuestions(match.next_questions);
      setClarifyHint(match?.copy || '');
      setStep('clarify');
      return;
    }
    setClarifyHint(match?.copy || 'Pick the closest option below or add a bit more detail.');
    setStep('match');
  }, []);

  const onCaptureComplete = useCallback((capture) => {
    setConcernChips(capture?.concern_chips || []);
    setInquiry(capture?.inquiry || '');
    setFunnelIntakeProposal(null);
    setCapturePayload(capture);
    setError('');
    setStep('kellyGate');
  }, []);

  const goBackToCaptureFromKelly = useCallback(() => {
    setFunnelIntakeProposal(null);
    setCapturePayload(null);
    setError('');
    setStep('match');
  }, []);

  const onMatchDual = useCallback(
    (match) => {
      setMatchResultState(match);
      setClarifyHint('');
      const id = match?.concern_id;
      if (!id) {
        setStep('specialist');
        return;
      }
      setConcernId(id);
      setConcernIdState(id);
      setPreviewLoading(true);
      fetchRoutinePreview(id)
        .then((data) => {
          setPreview(data);
          setPreviewCache(data);
          setStep('dual');
        })
        .catch((e) => {
          setError(e.message || 'Could not load preview');
          setStep('dual');
        })
        .finally(() => setPreviewLoading(false));
    },
    [],
  );

  const submitClarifyAnswers = useCallback(
    async (answers) => {
      setClarifyLoading(true);
      setError('');
      try {
        setClarifyAnswers(answers);
        const match = await postFunnelMatch({
          inquiry: getInquiry(),
          concern_chip: getConcernId() || null,
          face_read: getFaceRead(),
          confirmed_age: getConfirmedAge(),
          zip: getZip() || null,
          user_goal: getUserGoal(),
          clarify_answers: answers,
        });
        setMatchResult(match);
        setMatchResultState(match);
        if (match.route === 'clarify') {
          setClarifyQuestions(match.next_questions || []);
          setClarifyHint(match.copy || '');
          return;
        }
        if (match.route === 'dual' && match.concern_id) {
          onMatchDual(match);
          return;
        }
        if (match.route === 'specialist') {
          onMatchSpecialist(match);
          return;
        }
        if (match.route === 'program' && match.concern_id) {
          onMatchProgram(match);
          return;
        }
        setClarifyHint(match?.copy || 'Add a bit more detail.');
        setStep('match');
      } catch (e) {
        setError(e.message || 'Could not continue');
      } finally {
        setClarifyLoading(false);
      }
    },
    [onMatchDual, onMatchProgram, onMatchSpecialist],
  );

  const analyze = useCallback(async (blob) => {
    setStep('analyzing');
    setError('');
    try {
      const fr = await faceReadUpload(blob);
      if (String(fr.quality) === 'no_face') {
        throw new Error('No face detected. Try a clear, front-facing photo.');
      }
      setFaceRead(fr);
      const age = fr.apparent_age_estimate;
      if (age == null) throw new Error('Could not estimate age from this photo.');
      setEstimate(Math.round(Number(age)));
      setStep('confirm');
    } catch (e) {
      setStep('capture');
      setError(e.message || 'Estimate failed');
    }
  }, []);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      fileCamRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      setHasStream(true);
    } catch {
      fileCamRef.current?.click();
    }
  }

  async function takePhoto() {
    if (!hasStream) {
      await startCamera();
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (blob) await analyze(blob);
  }

  function onFile(file) {
    if (file) analyze(file);
  }

  function finishAge(age) {
    setConfirmedAge(age);
    setEstimate(Math.round(Number(age)));
    setStep('intent');
  }

  const goBackToIntent = useCallback(() => {
    clearMatchDraftState();
    setMatchResult(null);
    setMatchResultState(null);
    setConcernId('');
    setConcernIdState('');
    setClarifyAnswers(null);
    setClarifyHint('');
    setClarifyQuestions([]);
    setPreview(null);
    setPreviewCache(null);
    setError('');
    setStep('intent');
  }, []);

  const goBackToMatchFromClarify = useCallback(() => {
    setClarifyAnswers(null);
    setClarifyHint('');
    setClarifyQuestions([]);
    setError('');
    setStep('match');
  }, []);

  const goBackToConfirmFromIntent = useCallback(() => {
    setError('');
    setStep('confirm');
  }, []);

  const displayAge = getConfirmedAge() ?? estimate;

  return (
    <div className="funnel-root funnel-root--fullscreen">
      <Helmet>
        <title>Biological age estimate — Skin &amp; Care</title>
      </Helmet>
      <header className="funnel-nav funnel-nav--wide">
        <FunnelBrandLockup />
        <nav className="funnel-nav-links" aria-label="Primary">
          <a href="/">Home</a>
          <a href="/patients/patient-login.html">Login</a>
        </nav>
      </header>
      <main className="funnel-page funnel-page--fullscreen funnel-page--age">
        <FunnelStepDots step={step} />
        <FunnelAgeHeadline step={step} userGoal={getUserGoal()} />
        <p className="funnel-age-subline">{sublineForStep(step)}</p>
        {!ready && ['capture', 'analyzing', 'confirm', 'correct'].includes(step) ? (
          <p className="funnel-offline-notice">
            Photo estimate is offline in this environment. You can still enter your age on the next
            screen after continuing.
          </p>
        ) : null}

        {step === 'capture' ? (
          <div className="funnel-card funnel-card--age">
            <div className="funnel-viewfinder">
              <span className="funnel-vf-corner funnel-vf-corner--tl" aria-hidden="true" />
              <span className="funnel-vf-corner funnel-vf-corner--tr" aria-hidden="true" />
              <span className="funnel-vf-corner funnel-vf-corner--bl" aria-hidden="true" />
              <span className="funnel-vf-corner funnel-vf-corner--br" aria-hidden="true" />
              {hasStream ? (
                <video ref={videoRef} className="funnel-video" playsInline muted autoPlay />
              ) : (
                <div className="funnel-vf-idle" aria-hidden="true">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>Face the camera</span>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
            <input
              ref={fileCamRef}
              type="file"
              accept="image/*"
              capture="user"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <input
              ref={fileLibRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <div className="funnel-card-actions funnel-card-actions--stacked">
              <button type="button" className="funnel-btn" onClick={takePhoto}>
                Take a photo
              </button>
              <div className="funnel-or-divider" aria-hidden="true">
                or
              </div>
              <button
                type="button"
                className="funnel-btn funnel-btn-secondary"
                onClick={() => fileLibRef.current?.click()}
              >
                Choose from library
              </button>
            </div>
            {error ? <p className="funnel-error">{error}</p> : null}
          </div>
        ) : null}

        {step === 'analyzing' ? (
          <div className="funnel-card funnel-card--age">
            <div className="funnel-analyzing">
              <div className="funnel-analyzing-ring" aria-hidden="true" />
              <p className="funnel-analyzing-text">Reading your photo</p>
            </div>
          </div>
        ) : null}

        {step === 'confirm' ? (
          <div className="funnel-card funnel-card--age">
            <div className="funnel-age-display">
              <p className="funnel-age-label">Estimated skin age</p>
              <p className="funnel-age-number">{estimate}</p>
              <p className="funnel-age-sub">Based on your photo</p>
            </div>
            <div className="funnel-age-sep" aria-hidden="true" />
            <div className="funnel-card-actions funnel-card-actions--stacked">
              <button type="button" className="funnel-btn" onClick={() => finishAge(estimate)}>
                That looks right
              </button>
              <button
                type="button"
                className="funnel-btn funnel-btn-secondary"
                onClick={() => {
                  setCorrectAge(String(estimate ?? ''));
                  setStep('correct');
                }}
              >
                Let me correct it
              </button>
            </div>
          </div>
        ) : null}

        {step === 'correct' ? (
          <div className="funnel-card funnel-card--age">
            <label htmlFor="age-input" className="funnel-age-field-label">
              Your age
            </label>
            <input
              id="age-input"
              className="funnel-input funnel-input--age"
              type="number"
              min={13}
              max={100}
              inputMode="numeric"
              placeholder="—"
              value={correctAge}
              onChange={(e) => setCorrectAge(e.target.value)}
            />
            <div className="funnel-card-actions">
              <button
                type="button"
                className="funnel-btn"
                onClick={() => {
                  const n = Number(correctAge);
                  if (!Number.isFinite(n) || n < 13 || n > 100) {
                    setError('Enter an age between 13 and 100.');
                    return;
                  }
                  setError('');
                  finishAge(n);
                }}
              >
                Continue
              </button>
            </div>
            {error ? <p className="funnel-error">{error}</p> : null}
          </div>
        ) : null}

        {step === 'intent' ? (
          <FunnelIntentPicker
            onContinue={() => setStep('match')}
            onBack={goBackToConfirmFromIntent}
          />
        ) : null}

        {step === 'specialistZip' ? (
          <>
            <FunnelSpecialistZip
              onSpecialist={(match, z) => {
                setMatchResultState(match);
                if (z) {
                  setFunnelZip(z);
                  setZip(z);
                }
                setStep('specialist');
              }}
              onError={setError}
              onBack={goBackToIntent}
            />
            {error ? <p className="funnel-error">{error}</p> : null}
          </>
        ) : null}

        {step === 'clarify' ? (
          <>
            <FunnelClarifyQuestions
              questions={clarifyQuestions}
              loading={clarifyLoading}
              onSubmit={submitClarifyAnswers}
              onBack={goBackToMatchFromClarify}
            />
            {error ? <p className="funnel-error">{error}</p> : null}
          </>
        ) : null}

        {step === 'match' ? (
          <>
            <FunnelMatchInquiry
              onCaptureComplete={onCaptureComplete}
              onError={setError}
              onBack={goBackToIntent}
            />
            {error ? <p className="funnel-error">{error}</p> : null}
          </>
        ) : null}

        {step === 'kellyGate' ? (
          <>
            <FunnelKellyMatchGate
              capture={capturePayload}
              onProgram={onMatchProgram}
              onSpecialist={onMatchSpecialist}
              onClarify={onMatchClarify}
              onSpecialistZip={() => {
                setError('');
                setStep('specialistZip');
              }}
              onBack={goBackToCaptureFromKelly}
              onError={setError}
            />
            {error ? <p className="funnel-error">{error}</p> : null}
          </>
        ) : null}

        {step === 'dual' ? (
          <FunnelDualOffer
            match={matchResult}
            concernId={concernId}
            onStartTracking={() => setStep('preview')}
            onSave={() => setStep('save')}
            onBack={() => setStep('match')}
          />
        ) : null}

        {step === 'preview' && preview ? (
          <FunnelProgramPreview
            preview={preview}
            displayAge={displayAge}
            concernId={concernId}
            matchResult={matchResult}
            onSave={() => setStep('save')}
            onBack={() => setStep('kellyGate')}
            secondaryConcernIds={matchResult?.secondary_concern_ids}
          />
        ) : null}

        {step === 'specialist' ? (
          <FunnelSpecialistList
            match={matchResult}
            zip={funnelZip}
            onChangeZip={(z) => {
              setFunnelZip(z);
              setZip(z);
            }}
            onSave={() => setStep('save')}
            onBack={() =>
              setStep(getUserGoal() === 'find_specialist' ? 'specialistZip' : 'kellyGate')
            }
            onTrackWhileFinding={() => {
              setSpecialistUpsell(true);
              setUserGoal('both');
              setStep('match');
            }}
          />
        ) : null}

        {step === 'save' ? (
          <FunnelSaveEmail
            concernId={concernId}
            matchResult={matchResult}
            onDone={() => {
              setSavedAccount(true);
              setStep('done');
            }}
            onSkip={() => {
              setSavedAccount(false);
              setStep('done');
            }}
          />
        ) : null}

        {step === 'done' ? (
          <FunnelDone concernId={concernId} saved={savedAccount} />
        ) : null}
      </main>
      <FunnelScOrb />
    </div>
  );
}
