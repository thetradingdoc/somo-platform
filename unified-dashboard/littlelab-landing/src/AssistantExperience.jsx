import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AssistantChatPage from './AssistantChatPage';
import AssistantVoicePage from './AssistantVoicePage';
import AssistantResultsPage from './AssistantResultsPage';
import { useAssistantSession } from './useAssistantSession';
import { useConversationSphereLevel } from './useConversationSphereLevel';
import { useLandingLiveKit } from './useLandingLiveKit';
import { getOrCreateLandingSessionId } from './landingAssistantApi';
import { fetchVisionSessionState, incrementVisionMetric } from './landingLiveKitApi';
import { extractIngredientsFromImage } from './ingredientOcr';
import './skin-care-tokens.css';
import './assistant-shared.css';

const HASH_VOICE = '#assistant/voice';
const HASH_CHAT = '#assistant/chat';
const HASH_RESULTS = '#assistant/results';
const DUMMY_RESULT_SNAPSHOT = {
  schema_version: '1.0',
  generated_at: new Date().toISOString(),
  primary_concern: 'barrier_dryness_sensitivity',
  routine_conflicts: [
    {
      id: 'barrier_vs_strong_actives',
      severity: 'high',
      summary: 'Barrier stress appears alongside frequent retinoid + AHA use.',
      recommendation: 'Pause exfoliating acids for 7-10 days and reduce retinoid cadence.'
    },
    {
      id: 'reported_ingredient_reaction',
      severity: 'medium',
      summary: 'User reports stinging with fragranced products and vitamin C serum.',
      recommendation: 'Use fragrance-free barrier products and reintroduce actives slowly.'
    }
  ],
  secondary_concerns: ['redness_rosacea_dermatitis', 'pigmentation_dark_spots'],
  intent_primary: 'treat',
  intent_secondary: ['compare'],
  likely_triggers: ['retinoid', 'exfoliating_actives', 'fragrance'],
  body_areas: ['cheeks', 'chin_jaw'],
  procedure_interest: null,
  urgency_flag: null,
  confidence: {
    global: 0.79,
    primary_concern: 0.84,
    routine_conflicts: 0.75
  },
  next_ui_step: 'skincare_report'
};

function useDocumentHiddenPause() {
  const [hidden, setHidden] = useState(() =>
    typeof document !== 'undefined' ? document.hidden : false
  );
  useEffect(() => {
    const fn = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);
  return hidden;
}

function useVisualViewportKeyboardClass() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const shell = () => document.querySelector('.ax-shell');
    const upd = () => {
      const el = shell();
      if (!el) return;
      const gap = window.innerHeight - vv.height - (vv.offsetTop || 0);
      el.classList.toggle('ax-shell--kb', gap > 72);
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    upd();
    return () => {
      vv.removeEventListener('resize', upd);
      vv.removeEventListener('scroll', upd);
      const el = shell();
      if (el) el.classList.remove('ax-shell--kb');
    };
  }, []);
}

/**
 * Skin & Care assistant — voice + chat share session, 3D sphere, optional LiveKit (Try now room).
 */
export default function AssistantExperience({ onClose }) {
  const session = useAssistantSession();
  const {
    apiBase,
    messages,
    input,
    setInput,
    attachments,
    setAttachments,
    sending,
    sendUserMessage,
    resultSnapshot,
    toggleVoice,
    addFiles,
    interimCaption,
    voiceActive,
    sessionIdRef,
    pushAssistant,
    leadText,
    ingestScannedBarcode,
    ingestManualBarcode,
    submitManualIngredients,
    requestScanAnalysis,
    productTrackingActive,
    setProductTrackingActive,
    scanResult,
    pendingScanDecision,
    resolvePendingScanDecision,
    refreshResultSnapshot,
    submitResultEdit
  } = session;

  const [page, setPage] = useState(() => {
    if (typeof window === 'undefined') return 'voice';
    if (window.location.hash === HASH_CHAT) return 'chat';
    if (window.location.hash === HASH_RESULTS) return 'results';
    return 'voice';
  });
  const [visionState, setVisionState] = useState({
    checklist: [],
    guidance: null,
    sessionMetadata: {
      requested_regions: [],
      confirmed_regions: [],
      pending_regions: [],
      failed_regions: []
    }
  });
  const [scanUi, setScanUi] = useState({
    status: 'idle',
    barcode: '',
    productName: '',
    reason: ''
  });
  const [manualBarcodeInput, setManualBarcodeInput] = useState('');
  const [manualIngredientsInput, setManualIngredientsInput] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState('');

  const cameraRef = useRef(null);
  const imageRef = useRef(null);
  const fileRef = useRef(null);
  const ocrImageRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const getSessionId = useCallback(
    () => sessionIdRef.current || getOrCreateLandingSessionId(),
    [sessionIdRef]
  );

  const liveKit = useLandingLiveKit({
    apiBase,
    getSessionId,
    localVideoRef,
    remoteVideoContainerRef: remoteVideoRef,
    assistantPage: page
  });

  useEffect(() => {
    if (liveKit.isConnected) {
      liveKit.syncMicWithVoice(voiceActive);
    }
  }, [voiceActive, liveKit.isConnected, liveKit.syncMicWithVoice]);

  useEffect(() => {
    if (!liveKit?.inSession || !apiBase) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const sid = getSessionId();
        const data = await fetchVisionSessionState({ apiBase, sessionId: sid });
        if (cancelled) return;
        const checklist = Array.isArray(data.checklist) ? data.checklist : [];
        const requested = [...new Set(checklist.map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        const confirmed = [...new Set(checklist.filter((r) => r.status === 'passed').map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        const pending = [...new Set(checklist.filter((r) => r.status === 'pending' || r.status === 'capturing' || r.status === 'retry_needed').map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        const failed = [...new Set(checklist.filter((r) => r.status === 'failed_max_retries').map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        setVisionState({
          checklist,
          guidance: data.guidance || null,
          sessionMetadata: {
            requested_regions: requested,
            confirmed_regions: confirmed,
            pending_regions: pending,
            failed_regions: failed
          }
        });
      } catch (_) {}
    };
    void poll();
    const id = setInterval(poll, 1800);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveKit?.inSession, apiBase, getSessionId]);

  const cameraOffPromptedRef = useRef(false);
  useEffect(() => {
    if (!liveKit?.inSession || !liveKit?.isConnected) {
      cameraOffPromptedRef.current = false;
      return;
    }
    if (!liveKit.cameraEnabled && !cameraOffPromptedRef.current) {
      cameraOffPromptedRef.current = true;
      pushAssistant(
        'I need your camera on to analyze your face accurately. Please tap Start camera so I can continue your skin assessment.',
        { speak: true }
      );
      return;
    }
    if (liveKit.cameraEnabled) {
      cameraOffPromptedRef.current = false;
    }
  }, [liveKit?.inSession, liveKit?.isConnected, liveKit?.cameraEnabled, pushAssistant]);

  const captureGuardPromptedRef = useRef(false);
  useEffect(() => {
    const activeCapture =
      (visionState?.sessionMetadata?.pending_regions || []).length > 0 ||
      (visionState?.checklist || []).some((r) => ['pending', 'capturing', 'retry_needed'].includes(r.status));
    if (!liveKit?.inSession || !activeCapture) {
      captureGuardPromptedRef.current = false;
      return;
    }
    if (!liveKit?.cameraEnabled && !captureGuardPromptedRef.current) {
      captureGuardPromptedRef.current = true;
      pushAssistant(
        'Camera is required to continue this capture checklist. Please tap Start camera so I can verify the requested region.',
        { speak: true }
      );
      void incrementVisionMetric({
        apiBase,
        sessionId: getSessionId(),
        metricName: 'vision.capture.camera_off_incidents'
      }).catch(() => {});
      return;
    }
    if (liveKit?.cameraEnabled) {
      captureGuardPromptedRef.current = false;
    }
  }, [liveKit?.inSession, liveKit?.cameraEnabled, visionState, pushAssistant]);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const docHidden = useDocumentHiddenPause();
  useVisualViewportKeyboardClass();

  const speechLevelRef = useConversationSphereLevel({
    voiceActive,
    interimCaption,
    sending,
    liveKitConnected: liveKit.isConnected
  });

  // Phase 1-2: live barcode detection from camera feed with stabilization window.
  const barcodeSeenRef = useRef(new Map());
  const scanCoachRef = useRef({ lastPromptMs: 0, stabilizeCycles: 0 });
  useEffect(() => {
    if (!productTrackingActive) {
      setScanUi({ status: 'idle', barcode: '', productName: '', reason: '' });
      return undefined;
    }
    if (!liveKit?.inSession || !liveKit?.cameraEnabled) return undefined;
    if (typeof window === 'undefined' || typeof window.BarcodeDetector === 'undefined') return undefined;
    let cancelled = false;
    const preferredFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
    let detector = null;
    const initDetector = async () => {
      try {
        const raw = window.BarcodeDetector.getSupportedFormats?.();
        const supported = Array.isArray(raw) ? raw : Array.isArray(await raw) ? await raw : [];
        const formats = preferredFormats.filter((f) => supported.includes(f));
        detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
      } catch (_) {
        detector = new window.BarcodeDetector();
      }
    };
    const tick = async () => {
      if (cancelled) return;
      if (!detector) return;
      const video = localVideoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth < 8 || video.videoHeight < 8) return;
      try {
        setScanUi((prev) => ({ ...prev, status: 'scanning' }));
        const found = await detector.detect(video);
        const now = Date.now();
        if (!found?.length) {
          scanCoachRef.current.stabilizeCycles += 1;
          if (scanCoachRef.current.stabilizeCycles >= 4 && now - scanCoachRef.current.lastPromptMs > 12000) {
            scanCoachRef.current.lastPromptMs = now;
            scanCoachRef.current.stabilizeCycles = 0;
            pushAssistant(
              'I am tracking in real-time. Please bring the product label closer, reduce glare, and turn it slightly so the barcode is fully visible.',
              { speak: true }
            );
          }
        }
        for (const item of found || []) {
          const raw = String(item?.rawValue || '').replace(/[^\d]/g, '');
          if (!/^\d{8,14}$/.test(raw)) continue;
          const state = barcodeSeenRef.current.get(raw) || { firstMs: now, hits: 0, lastMs: 0 };
          state.hits += 1;
          state.lastMs = now;
          barcodeSeenRef.current.set(raw, state);
          setScanUi({ status: 'stabilizing', barcode: raw, productName: '', reason: '' });
          const stable = state.hits >= 2 && now - state.firstMs <= 4500;
          if (stable) {
            scanCoachRef.current.stabilizeCycles = 0;
            const out = await ingestScannedBarcode(raw);
            if (out?.success) {
              setScanUi({ status: 'matched', barcode: raw, productName: out.productName || '', reason: '' });
              setProductTrackingActive(false);
            } else if (out?.reason === 'not_found') {
              setScanUi({ status: 'not_found', barcode: raw, productName: '', reason: out.reason });
              if (now - scanCoachRef.current.lastPromptMs > 10000) {
                scanCoachRef.current.lastPromptMs = now;
                pushAssistant(
                  'I can see part of the code but not enough to confirm. Please turn the product around and hold it steady for one second.',
                  { speak: true }
                );
              }
            } else if (out?.reason !== 'cooldown') {
              setScanUi({ status: 'error', barcode: raw, productName: '', reason: out?.reason || 'lookup_failed' });
            }
            barcodeSeenRef.current.delete(raw);
          }
        }
        for (const [code, state] of barcodeSeenRef.current.entries()) {
          if (now - state.lastMs > 5000) barcodeSeenRef.current.delete(code);
        }
      } catch (_) {}
    };
    let id = null;
    void initDetector().then(() => {
      if (cancelled) return;
      void tick();
      id = setInterval(() => {
        void tick();
      }, 800);
    });
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ingestScannedBarcode, liveKit?.cameraEnabled, liveKit?.inSession, localVideoRef, productTrackingActive, pushAssistant, setProductTrackingActive]);

  const handleManualBarcodeSubmit = useCallback(async () => {
    const out = await ingestManualBarcode(manualBarcodeInput);
    if (out?.success) {
      setScanUi({ status: 'matched', barcode: out.barcode || manualBarcodeInput, productName: out.productName || '', reason: '' });
      setManualBarcodeInput('');
      return;
    }
    if (out?.reason === 'invalid_barcode') {
      setScanUi({ status: 'error', barcode: manualBarcodeInput, productName: '', reason: 'invalid_barcode' });
      return;
    }
    if (out?.reason === 'not_found') {
      setScanUi({ status: 'not_found', barcode: manualBarcodeInput, productName: '', reason: 'not_found' });
      return;
    }
    setScanUi({ status: 'error', barcode: manualBarcodeInput, productName: '', reason: out?.reason || 'lookup_failed' });
  }, [ingestManualBarcode, manualBarcodeInput]);

  const handleManualIngredientsSubmit = useCallback(async () => {
    const out = await submitManualIngredients(manualIngredientsInput);
    if (out?.success) {
      setManualIngredientsInput('');
      setScanUi((prev) => ({ ...prev, status: 'manual_ingredients_sent' }));
    }
  }, [manualIngredientsInput, submitManualIngredients]);

  const handleIngredientOcrFiles = useCallback(async (fileList) => {
    const file = Array.from(fileList || [])[0] || null;
    if (!file) return;
    setOcrBusy(true);
    setOcrError('');
    try {
      const text = await extractIngredientsFromImage(file);
      setManualIngredientsInput(text);
      const out = await submitManualIngredients(text);
      if (!out?.success) {
        setOcrError('OCR extracted text, but analysis failed. You can edit and retry.');
      }
    } catch (e) {
      setOcrError('Could not read ingredients from image. Please type ingredients manually.');
    } finally {
      setOcrBusy(false);
    }
  }, [setManualIngredientsInput, submitManualIngredients]);

  useEffect(() => {
    if (resultSnapshot?.next_ui_step === 'skincare_report') {
      setPage('results');
    }
  }, [resultSnapshot]);

  const setHashForPage = useCallback((next) => {
    const h = next === 'chat' ? HASH_CHAT : next === 'results' ? HASH_RESULTS : HASH_VOICE;
    if (typeof window !== 'undefined' && window.location.hash !== h) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`);
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === HASH_CHAT) setPage('chat');
      else if (window.location.hash === HASH_RESULTS) setPage('results');
      else setPage('voice');
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setHashForPage(page);
  }, [page, setHashForPage]);

  const handleClose = useCallback(() => {
    liveKit.leaveRoom();
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    onClose();
  }, [liveKit, onClose]);

  const openChat = useCallback(() => setPage('chat'), []);
  const backToVoice = useCallback(() => setPage('voice'), []);

  const ariaLabel =
    page === 'chat'
      ? 'Skin and Care assistant — chat'
      : page === 'results'
        ? 'Skin and Care assistant — results'
        : 'Skin and Care assistant — voice';

  /** Prefer server snapshot; fill hero image from last scan when API omitted `product.image_url`. */
  const activeSnapshot = useMemo(() => {
    const base = resultSnapshot ? { ...resultSnapshot } : { ...DUMMY_RESULT_SNAPSHOT };
    const p = scanResult?.product;
    const scanImg = String(p?.image_url || p?.image_front_url || '').trim();
    const scanName = String(p?.product_name || '').trim();
    const existingImg = String(
      base?.product?.image_url || base?.source_product?.image_url || base?.image_url || ''
    ).trim();
    if (scanImg && !existingImg) {
      base.product = {
        ...(base.product || {}),
        ...(scanName ? { name: scanName } : {}),
        image_url: scanImg
      };
    }
    return base;
  }, [resultSnapshot, scanResult]);


  return (
    <div className="ax-shell" role="dialog" aria-label={ariaLabel}>
      <div className="ax-hidden-file-root" aria-hidden>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="ax-hidden-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          className="ax-hidden-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={ocrImageRef}
          type="file"
          accept="image/*"
          className="ax-hidden-input"
          onChange={(e) => {
            void handleIngredientOcrFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileRef}
          type="file"
          className="ax-hidden-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {page === 'voice' ? (
        <AssistantVoicePage
          onClose={handleClose}
          onOpenChat={openChat}
          onRequestScanAnalysis={requestScanAnalysis}
          onOpenUpload={() => imageRef.current?.click()}
          apiBase={apiBase}
          messages={messages}
          interimCaption={interimCaption}
          voiceActive={voiceActive}
          sending={sending}
          toggleVoice={toggleVoice}
          prefersReducedMotion={prefersReducedMotion}
          cameraRef={cameraRef}
          speechLevelRef={speechLevelRef}
          spherePaused={docHidden}
          liveKit={liveKit}
          localVideoRef={localVideoRef}
          remoteVideoContainerRef={remoteVideoRef}
          leadText={leadText}
          scanUi={scanUi}
          scanResult={scanResult}
          pendingScanDecision={pendingScanDecision}
          onResolvePendingScanDecision={resolvePendingScanDecision}
          manualBarcodeInput={manualBarcodeInput}
          setManualBarcodeInput={setManualBarcodeInput}
          onManualBarcodeSubmit={handleManualBarcodeSubmit}
          manualIngredientsInput={manualIngredientsInput}
          setManualIngredientsInput={setManualIngredientsInput}
          onManualIngredientsSubmit={handleManualIngredientsSubmit}
          onUploadIngredientPhoto={() => ocrImageRef.current?.click()}
          ocrBusy={ocrBusy}
          ocrError={ocrError}
          productTrackingActive={productTrackingActive}
          onToggleScan={() => setProductTrackingActive((v) => !v)}
        />
      ) : page === 'chat' ? (
        <AssistantChatPage
          onBack={backToVoice}
          onClose={handleClose}
          messages={messages}
          input={input}
          setInput={setInput}
          attachments={attachments}
          setAttachments={setAttachments}
          sending={sending}
          sendUserMessage={sendUserMessage}
          cameraRef={cameraRef}
          imageRef={imageRef}
          fileRef={fileRef}
          speechLevelRef={speechLevelRef}
          prefersReducedMotion={prefersReducedMotion}
          spherePaused={docHidden}
          liveKit={liveKit}
          localVideoRef={localVideoRef}
          remoteVideoContainerRef={remoteVideoRef}
          scanResult={scanResult}
          pendingScanDecision={pendingScanDecision}
          onResolvePendingScanDecision={resolvePendingScanDecision}
        />
      ) : (
        <AssistantResultsPage
          snapshot={activeSnapshot}
          loading={sending}
          onBack={backToVoice}
          onClose={handleClose}
          onRefresh={refreshResultSnapshot}
          onSaveEdit={submitResultEdit}
        />
      )}
    </div>
  );
}
