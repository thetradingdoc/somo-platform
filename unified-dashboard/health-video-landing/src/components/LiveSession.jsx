import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockClosedIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useHealthSession } from '../lib/HealthSessionContext.jsx';
import { useLiveKit } from '../lib/useLiveKit.js';
import { useKellySse } from '../lib/useKellySse.js';
import { useBrowserStt, sttSupported } from '../lib/useBrowserStt.js';
import { sendTurn, endSession, resolveSseUrl } from '../lib/healthSessionApi.js';
import { extractBodyRegionGuidance, extractCareUrgency } from '../lib/toolCardMap.js';
import { useJourneyGuard } from '../lib/useJourneyGuard.js';
import {
  buildTopicChips,
  createLocalGreeting,
  mergeAssistantMessage
} from '../lib/sessionUtils.js';
import { useKellyPresence } from '../lib/useKellyPresence.js';
import { useSessionStages } from '../lib/useSessionStages.js';
import { useSymptomNotes } from '../lib/useSymptomNotes.js';
import { useMediaQuery, DESKTOP_MEDIA } from '../lib/useMediaQuery.js';
import SomoLogo from './brand/SomoLogo.jsx';
import SessionHeaderLive from './journey/SessionHeaderLive.jsx';
import SessionPreview from './journey/SessionPreview.jsx';
import SessionLayoutMobile from './journey/SessionLayoutMobile.jsx';
import SessionLayoutDesktop from './journey/SessionLayoutDesktop.jsx';
import CameraEducationSheet from './journey/CameraEducationSheet.jsx';
import PermissionDeniedSheet from './journey/PermissionDeniedSheet.jsx';
import IntakeSummarySheet from './journey/IntakeSummarySheet.jsx';
import EndSessionSheet from './EndSessionSheet.jsx';

let msgId = 0;

export default function LiveSession() {
  const navigate = useNavigate();
  useJourneyGuard(true);
  const isDesktop = useMediaQuery(DESKTOP_MEDIA);
  const { session, setReport } = useHealthSession();
  const videoRef = useRef(null);
  const chatEndRef = useRef(null);
  const { connect, toggleMic, toggleCamera, disconnect } = useLiveKit();

  const [phase, setPhase] = useState('connecting');
  const [connStatus, setConnStatus] = useState('connecting');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [bodyGuidance, setBodyGuidance] = useState(null);
  const [toolEvents, setToolEvents] = useState([]);
  const [urgencyLevel, setUrgencyLevel] = useState(null);
  const [cameraFlow, setCameraFlow] = useState('idle');
  const [showCaptureConfirm, setShowCaptureConfirm] = useState(false);
  const [riskVisible, setRiskVisible] = useState(false);
  const [showIntakeSheet, setShowIntakeSheet] = useState(false);
  const [showEndSheet, setShowEndSheet] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [startWithCamera, setStartWithCamera] = useState(false);
  const [showPermDenied, setShowPermDenied] = useState(false);
  const [cameraEducated, setCameraEducated] = useState(false);

  const patientMessageCount = messages.filter((m) => m.speaker === 'patient').length;
  const lastKellyText = [...messages].reverse().find((m) => m.speaker === 'assistant')?.text || '';

  const { stages } = useSessionStages({
    patientMessageCount,
    toolEventCount: toolEvents.length,
    endSheetOpen: showEndSheet || showIntakeSheet
  });

  const symptomNotes = useSymptomNotes(messages, toolEvents);
  const topicChips = buildTopicChips(messages);

  const appendMsg = useCallback((speaker, text) => {
    setThinking(false);
    if (speaker === 'assistant') {
      setMessages((prev) => mergeAssistantMessage(prev, text));
      setBodyGuidance(null);
    } else {
      setMessages((prev) => [...prev, { id: ++msgId, speaker, text }]);
    }
  }, []);

  const onToolEvent = useCallback((payload) => {
    setToolEvents((prev) => [...prev, payload]);

    const guidance = extractBodyRegionGuidance(payload);
    if (guidance) {
      setCameraFlow('consent');
      setBodyGuidance(guidance);
    }

    const urgency = extractCareUrgency(payload);
    if (urgency) setUrgencyLevel(urgency);

    if (payload?.name === 'vision_caption') {
      setShowCaptureConfirm(true);
      setTimeout(() => setShowCaptureConfirm(false), 3000);
    }
  }, []);

  const sseUrl = session?.sseUrl ? resolveSseUrl(session.sseUrl) : null;
  const sseEnabled = (phase === 'live' || phase === 'preview') && !!sseUrl;

  useKellySse({
    url: sseUrl,
    enabled: sseEnabled,
    handlers: {
      onPatientLine: (t) => appendMsg('patient', t),
      onAssistantLine: (t) => appendMsg('assistant', t),
      onThinking: () => setThinking(true),
      onToolEvent,
      onRisk: () => setRiskVisible(true)
    }
  });

  const submitText = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || !session?.sessionId) return;
    appendMsg('patient', trimmed);
    setInputText('');
    try {
      await sendTurn(session.sessionId, trimmed);
    } catch (e) {
      setError(e.message);
    }
  }, [session?.sessionId, appendMsg]);

  const handleSttFinal = useCallback(async (text) => {
    await submitText(text);
  }, [submitText]);

  const { listening } = useBrowserStt({
    enabled: phase === 'live' && micOn && !textOnly && sttSupported(),
    locale: session?.locale || 'en',
    onFinal: handleSttFinal
  });

  const presenceLive = useKellyPresence({
    thinking,
    listening,
    micOn,
    textOnly,
    riskVisible,
    urgencyLevel,
    patientMessageCount
  });

  useEffect(() => {
    if (!session?.sessionId) {
      navigate('/start', { replace: true });
    }
  }, [session, navigate]);

  useEffect(() => {
    if (!camOn || !videoRef.current) return undefined;
    const frame = requestAnimationFrame(() => {
      toggleCamera(true, videoRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [camOn, toggleCamera, isDesktop]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, cameraFlow, showCaptureConfirm, toolEvents.length]);

  const beginSession = useCallback(async (opts = {}) => {
    const { mic = true, camera = false } = opts;
    setError('');
    setConnStatus('connecting');
    try {
      await connect({
        url: session.livekit.url,
        token: session.livekit.token,
        videoEl: videoRef.current,
        cameraEnabled: camera,
        micEnabled: mic,
        onStatus: (s) => {
          if (s === 'connected') {
            setConnStatus('connected');
            setConnected(true);
            setShowPermDenied(false);
            setPhase((p) => (p === 'denied' ? 'preview' : 'preview'));
          } else if (s === 'connecting' || s === 'reconnecting') {
            setConnStatus(s);
          } else if (s === 'disconnected') {
            setConnStatus('disconnected');
          }
        }
      });
      if (mic && !sttSupported()) {
        setTextOnly(true);
        setMicOn(false);
      }
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.message?.includes('Permission')) {
        setShowPermDenied(true);
        setPhase('preview');
      } else {
        setError(e.message || 'Could not connect');
        setShowPermDenied(true);
        setPhase('preview');
      }
    }
  }, [connect, session]);

  useEffect(() => {
    if (session?.sessionId && phase === 'connecting') {
      beginSession({ mic: true, camera: false });
    }
  }, [session?.sessionId, phase, beginSession]);

  const enterLiveChat = useCallback(async () => {
    setMessages((prev) => {
      if (prev.some((m) => m.speaker === 'assistant')) return prev;
      return [createLocalGreeting(session?.displayName)];
    });
    setPhase('live');

    if (startWithCamera) {
      setCameraEducated(true);
      try {
        setCamOn(true);
        setCameraFlow('active');
        await toggleCamera(true, videoRef.current);
      } catch (e) {
        setError(e.message);
        setCamOn(false);
        setCameraFlow('idle');
      }
    }
  }, [startWithCamera, toggleCamera, session?.displayName]);

  const handleMicToggle = useCallback(async () => {
    const next = !micOn;
    setMicOn(next);
    if (!textOnly) await toggleMic(next);
  }, [micOn, textOnly, toggleMic]);

  const handleCameraToggle = useCallback(() => {
    if (!camOn) {
      if (!cameraEducated) {
        setCameraFlow('education');
        return;
      }
      setCamOn(true);
      setCameraFlow('active');
      toggleCamera(true, videoRef.current);
      return;
    }
    setCamOn(false);
    setCameraFlow('idle');
    toggleCamera(false, videoRef.current);
    setBodyGuidance(null);
  }, [camOn, cameraEducated, toggleCamera]);

  const handleEducationContinue = async () => {
    setCameraFlow('idle');
    setCameraEducated(true);
    try {
      setCamOn(true);
      setCameraFlow('active');
      await toggleCamera(true, videoRef.current);
    } catch (e) {
      setError(e.message);
      setCamOn(false);
      setCameraFlow('idle');
    }
  };

  const handleCameraAccept = async () => {
    setCameraFlow('active');
    try {
      setCamOn(true);
      await toggleCamera(true, videoRef.current);
    } catch (e) {
      setError(e.message);
      setCamOn(false);
      setCameraFlow('idle');
    }
  };

  const handleCameraDecline = () => {
    setCameraFlow('idle');
    setBodyGuidance(null);
  };

  const handleOverlayDismiss = () => {
    setBodyGuidance(null);
    setCameraFlow('confirmed');
    setShowCaptureConfirm(true);
    setTimeout(() => {
      setShowCaptureConfirm(false);
      setCameraFlow('active');
    }, 2500);
  };

  const handleEndRequest = () => setShowIntakeSheet(true);

  const handleIntakeConfirm = () => {
    setShowIntakeSheet(false);
    setShowEndSheet(true);
  };

  const handleEndConfirm = async () => {
    setEnding(true);
    try {
      const data = await endSession(session.sessionId, session.sessionToken);
      await disconnect();
      setReport(data.session?.report || null);
      await new Promise((r) => setTimeout(r, 1500));
      navigate('/report');
    } catch (e) {
      setError(e.message);
      setEnding(false);
      setShowEndSheet(false);
    }
  };

  const statusLabel = connStatus === 'connected'
    ? 'Connected · Kelly'
    : connStatus === 'connecting'
      ? 'Connecting…'
      : connStatus === 'reconnecting'
        ? 'Reconnecting…'
        : 'Health chat';

  const displayInitial = session?.displayName?.[0]?.toUpperCase() || 'U';
  const isPreview = phase === 'preview';
  const isLive = phase === 'live';
  const showKellyConsent = cameraFlow === 'consent' && bodyGuidance;

  const progressLabel = patientMessageCount >= 1
    ? (stages.find((s) => s.active)?.label || null)
    : null;

  const layoutProps = {
    riskVisible,
    presenceLive,
    listening,
    lastKellyText,
    videoRef,
    camOn,
    bodyGuidance,
    onOverlayDismiss: handleOverlayDismiss,
    stages,
    patientMessageCount,
    urgencyLevel,
    textOnly,
    messages,
    thinking,
    displayInitial,
    toolEvents,
    showKellyConsent,
    showCaptureConfirm,
    chatEndRef,
    isLive,
    connected,
    inputText,
    onInputChange: setInputText,
    onSend: () => submitText(inputText),
    onMicToggle: handleMicToggle,
    micOn,
    onCameraToggle: handleCameraToggle,
    onCameraAccept: handleCameraAccept,
    onCameraDecline: handleCameraDecline,
    onSelectReply: submitText,
    connStatus,
    error
  };

  const outerClass = [
    'hv-session-outer',
    isLive ? 'hv-session-outer--live' : '',
    isPreview ? 'hv-session-outer--preview' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={outerClass}>
      <div className="hv-session-frame">
        {isPreview && (
          <header className="hv-sess-header-light">
            <SomoLogo variant="light" size="nav" />
            <div className="hv-sess-status hv-sess-status--light">
              {connStatus === 'connecting' || connStatus === 'reconnecting' ? (
                <ArrowPathIcon className="hv-icon hv-icon--sm hv-spin" aria-hidden="true" />
              ) : (
                <span className={`hv-conn-dot ${connStatus !== 'connected' ? 'connecting' : ''}`} />
              )}
              {statusLabel}
            </div>
            <span className="hv-sess-private hv-sess-private--light">
              <LockClosedIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
              Private
            </span>
          </header>
        )}

        {isPreview && (
          <SessionPreview
            displayName={session?.displayName}
            connecting={!connected}
            onContinue={enterLiveChat}
            onEnableCameraForLive={() => setStartWithCamera(true)}
          />
        )}

        {isLive && (
          <>
            <SessionHeaderLive
              connStatus={connStatus}
              statusLabel={statusLabel}
              progressLabel={progressLabel}
              onFinish={handleEndRequest}
            />
            {isDesktop ? (
              <SessionLayoutDesktop {...layoutProps} />
            ) : (
              <SessionLayoutMobile {...layoutProps} />
            )}
          </>
        )}

        <CameraEducationSheet
          open={cameraFlow === 'education'}
          onContinue={handleEducationContinue}
          onCancel={() => setCameraFlow('idle')}
        />

        <PermissionDeniedSheet
          open={showPermDenied}
          onTextOnly={() => {
            setTextOnly(true);
            setMicOn(false);
            setShowPermDenied(false);
            beginSession({ mic: false, camera: false });
          }}
          onRetryMic={() => {
            setTextOnly(false);
            setMicOn(true);
            setShowPermDenied(false);
            beginSession({ mic: true, camera: false });
          }}
        />

        <IntakeSummarySheet
          open={showIntakeSheet}
          chips={topicChips}
          notes={symptomNotes}
          onConfirm={handleIntakeConfirm}
          onCancel={() => setShowIntakeSheet(false)}
        />

        <EndSessionSheet
          open={showEndSheet}
          loading={ending}
          chips={topicChips}
          onConfirm={handleEndConfirm}
          onCancel={() => !ending && setShowEndSheet(false)}
        />
      </div>
    </div>
  );
}
