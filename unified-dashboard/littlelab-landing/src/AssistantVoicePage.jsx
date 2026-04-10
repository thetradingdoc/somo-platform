import React from 'react';
import { CameraIcon, ChatBubbleLeftRightIcon, ChevronLeftIcon, MicrophoneIcon, PhotoIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import AgentSphereCanvas from './AgentSphereCanvas';
import LiveKitPanel from './LiveKitPanel';
import './assistant-shared.css';
import './assistant-voice.css';
import './assistant-livekit.css';

export default function AssistantVoicePage({
  onClose,
  onOpenChat,
  onRequestScanAnalysis,
  onOpenUpload,
  apiBase,
  voiceActive,
  sending,
  toggleVoice,
  prefersReducedMotion,
  speechLevelRef,
  spherePaused,
  liveKit,
  localVideoRef,
  remoteVideoContainerRef,
  productTrackingActive,
  scanUi,
  scanResult,
  manualBarcodeInput,
  setManualBarcodeInput,
  onManualBarcodeSubmit,
  manualIngredientsInput,
  setManualIngredientsInput,
  onManualIngredientsSubmit,
  onUploadIngredientPhoto,
  ocrBusy,
  ocrError,
  pendingScanDecision,
  onResolvePendingScanDecision,
  onToggleScan
}) {
  const inSession = liveKit?.inSession;
  const inSessionStage = inSession || liveKit?.entryStep === 'session';
  const scanStatusText = !productTrackingActive
    ? ''
    : scanUi?.status === 'matched'
      ? `Product detected: ${scanUi.productName || scanUi.barcode}`
      : scanUi?.status === 'stabilizing'
        ? `Barcode detected: ${scanUi.barcode} — stabilizing...`
        : scanUi?.status === 'not_found'
          ? `Barcode ${scanUi.barcode} unclear. Bring it closer and turn it around.`
          : scanUi?.status === 'error'
            ? 'Scan detected, lookup failed. Try better lighting and hold still.'
            : scanUi?.status === 'scanning'
              ? 'Tracking label in real-time...'
                : 'Scan Barcode — point product barcode toward camera.';
  const quality = scanResult?.quality || null;
  const analyzeLabel = quality?.analyzeLabel || 'Analyze for my skin';
  const canAnalyze = !!quality?.analyzeEnabled;
  const handleAnalyzeClick = () => {
    if (typeof onRequestScanAnalysis === 'function') {
      void onRequestScanAnalysis();
    } else {
      onOpenChat();
    }
  };

  return (
    <div className={`axv-root ${inSessionStage ? 'axv-root--session' : ''}`}>
      <header className={`axv-header ${inSessionStage ? 'axv-header--floating' : ''}`}>
        <button type="button" className="axv-icon-btn" onClick={onClose} aria-label="Back to landing">
          <ChevronLeftIcon className="ax-heroicon" aria-hidden />
        </button>
        <div className="axv-pill">
          <img
            className="axv-pill-logo"
            src="/images/branding/logo-panda.png"
            alt=""
            width={40}
            height={40}
          />
          <span>Skin &amp; Care</span>
        </div>
        {inSessionStage ? (
          <button type="button" className="axv-icon-btn axv-header-chat" onClick={onOpenChat} aria-label="Open chat">
            <ChatBubbleLeftRightIcon className="ax-heroicon" aria-hidden />
          </button>
        ) : (
          <span className="axv-header-spacer" aria-hidden />
        )}
      </header>

      <div className={`axv-scan-wrap ${inSessionStage ? 'axv-scan-wrap--live' : ''}`}>
        <video
          ref={localVideoRef}
          className={inSessionStage ? 'axv-scan-hero' : 'axv-scan-video-hidden'}
          playsInline
          autoPlay
          muted
          aria-label="Your camera"
        />
        {inSessionStage ? (
          <>
            <div ref={remoteVideoContainerRef} className="axv-scan-remotes" role="region" aria-label="Other participants" />
            {productTrackingActive ? (
              <>
                <div className="axv-scan-reticle" aria-hidden>
                  <span className="axv-reticle-corner tl" />
                  <span className="axv-reticle-corner tr" />
                  <span className="axv-reticle-corner bl" />
                  <span className="axv-reticle-corner br" />
                </div>
                <div className="axv-scan-status">{scanStatusText}</div>
                <div className="axv-scan-manual">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="axv-scan-input"
                    placeholder="Enter barcode (8–14 digits)"
                    value={manualBarcodeInput}
                    onChange={(e) => setManualBarcodeInput(e.target.value)}
                  />
                  <button type="button" className="axv-scan-submit" onClick={onManualBarcodeSubmit}>
                    Lookup
                  </button>
                </div>
                {(scanUi?.status === 'not_found' || scanUi?.reason === 'not_found') ? (
                  <div className="axv-scan-recovery">
                    <p className="axv-scan-recovery-title">Product not found. Add ingredients to continue analysis:</p>
                    <textarea
                      className="axv-scan-textarea"
                      rows={3}
                      placeholder="Paste ingredient list here..."
                      value={manualIngredientsInput}
                      onChange={(e) => setManualIngredientsInput(e.target.value)}
                    />
                    <button type="button" className="axv-scan-submit" onClick={onManualIngredientsSubmit}>
                      Analyze ingredients
                    </button>
                    <button type="button" className="axv-scan-submit" onClick={onUploadIngredientPhoto} disabled={ocrBusy}>
                      {ocrBusy ? 'Reading image…' : 'Upload ingredient photo (OCR)'}
                    </button>
                    {ocrError ? <p className="axv-scan-recovery-title">{ocrError}</p> : null}
                  </div>
                ) : null}
                {scanUi?.reason === 'invalid_barcode' ? (
                  <p className="axv-scan-recovery-title">Invalid barcode. Use digits only (8–14).</p>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {scanResult ? (
        <div className="axv-analysis-cta">
          <span className={`axv-quality axv-quality--${quality?.tier || 'insufficient'}`}>
            {quality?.summary || 'Scan profile'}
          </span>
          <span className="axv-provenance">Source: {scanResult?.dataSource || 'unknown'}</span>
          <button type="button" className={`axv-liquid-btn ${canAnalyze ? 'axv-liquid-btn--active' : ''}`} disabled={!canAnalyze} onClick={handleAnalyzeClick}>
            {analyzeLabel}
          </button>
        </div>
      ) : null}
      {scanResult ? (
        <div className="axv-analysis-cta axv-analysis-cta--meta">
          <span className="axv-provenance">Category: {scanResult?.categoryRoute || 'unknown'}</span>
          <span className="axv-provenance">Ingredients: {scanResult?.ingredientFlags?.hasIngredients ? 'available' : 'missing'}</span>
          {scanResult?.sparseData ? <span className="axv-provenance">Sparse data</span> : null}
        </div>
      ) : null}
      {pendingScanDecision ? (
        <div className="axv-scan-recovery">
          <p className="axv-scan-recovery-title">Second product detected. Compare with previous, refine current context, or reset?</p>
          <div className="axv-scan-manual">
            <button type="button" className="axv-scan-submit" onClick={() => onResolvePendingScanDecision?.('compare')}>Compare A vs B</button>
            <button type="button" className="axv-scan-submit" onClick={() => onResolvePendingScanDecision?.('refine')}>Refine</button>
            <button type="button" className="axv-scan-submit" onClick={() => onResolvePendingScanDecision?.('reset')}>Reset</button>
          </div>
        </div>
      ) : null}

      <div className={`axv-body ${inSessionStage ? 'axv-body--session-bar' : ''}`}>
        {!inSessionStage ? (
          <>
            <section className="axv-welcome" aria-label="Welcome to Kelly">
              <p className="axv-welcome-hint">Say <strong>“Hi Kelly”</strong> once the call starts to wake me up instantly.</p>
              <div className="axv-sphere-wrap axv-sphere-wrap--welcome">
                <AgentSphereCanvas
                  className="axv-canvas"
                  speechLevelRef={speechLevelRef}
                  prefersReducedMotion={prefersReducedMotion}
                  paused={spherePaused}
                />
              </div>
              {sending && <p className="axv-caption-status">Thinking…</p>}
            </section>
          </>
        ) : (
          <div className="axv-session-shell">
            <div className="axv-session-sphere axv-session-sphere--bottom-left">
              <AgentSphereCanvas
                className="axv-session-sphere-canvas"
                speechLevelRef={speechLevelRef}
                prefersReducedMotion={prefersReducedMotion}
                paused={spherePaused}
              />
            </div>
          </div>
        )}

        {liveKit?.entryStep === 'invite' ? (
          <LiveKitPanel
            liveKit={liveKit}
            variant="voice"
            localVideoRef={localVideoRef}
            remoteVideoContainerRef={remoteVideoContainerRef}
            embedLocalVideo={false}
          />
        ) : null}

        {inSessionStage ? (
          <div className="axv-liquid-nav-wrap">
            <div className="axv-liquid-nav" role="toolbar" aria-label="Session controls">
              <button type="button" className={`axv-liquid-btn ${productTrackingActive ? 'axv-liquid-btn--active' : ''}`} onClick={onToggleScan}>
                <QrCodeIcon className="ax-heroicon" aria-hidden />
                <span>Scan</span>
              </button>
              <button
                type="button"
                className={`axv-liquid-btn ${voiceActive ? 'axv-liquid-btn--active' : ''}`}
                onClick={() => toggleVoice(() => {})}
                aria-pressed={voiceActive}
                disabled={sending}
              >
                <MicrophoneIcon className="ax-heroicon" aria-hidden />
                <span>Talk</span>
              </button>
              <button type="button" className="axv-liquid-btn" onClick={onOpenUpload}>
                <PhotoIcon className="ax-heroicon" aria-hidden />
                <span>Upload</span>
              </button>
              <button
                type="button"
                className={`axv-liquid-btn ${liveKit?.cameraEnabled ? 'axv-liquid-btn--active' : ''}`}
                onClick={() => liveKit.setCameraOn(!liveKit.cameraEnabled)}
              >
                <CameraIcon className="ax-heroicon" aria-hidden />
                <span>{liveKit?.cameraEnabled ? 'Video On' : 'Video Off'}</span>
              </button>
            </div>
          </div>
        ) : null}

        {!inSessionStage ? (
          <p className="axv-disclaimer">
            Ask about your skin, routine, or ingredients. We analyze your questions and summarize guidance here—this
            isn&apos;t a medical diagnosis. For emergencies, contact your local emergency services.
            <span className="axv-api-hint">
              {apiBase ? ' Connected to API.' : ' Demo mode — set REACT_APP_API_BASE for live replies.'}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
