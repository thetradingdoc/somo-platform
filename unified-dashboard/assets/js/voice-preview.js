(function (global) {
  const API_BASE = () =>
    (typeof resolveApiBase === 'function'
      ? resolveApiBase()
      : (global.API_BASE || global.location?.origin || 'http://localhost:4000').replace(/\/$/, ''));

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchPreview(params = {}) {
    const qs = new URLSearchParams();
    if (params.greeting) qs.set('greeting', params.greeting);
    if (params.outbound_opener) qs.set('outbound_opener', params.outbound_opener);
    if (params.outbound_enabled !== undefined) {
      qs.set('outbound_enabled', params.outbound_enabled ? '1' : '0');
    }
    if (params.tone_preset) qs.set('tone_preset', params.tone_preset);
    const url = `${API_BASE()}/api/voice-agent/preview${qs.toString() ? `?${qs}` : ''}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Preview unavailable');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Preview failed');
    return json;
  }

  async function playLiveOpener(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${API_BASE()}/api/voice-agent/preview/tts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed })
      });
      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return;
      }
    } catch (_) {}
    if (typeof global.speechSynthesis !== 'undefined' && global.SpeechSynthesisUtterance) {
      global.speechSynthesis.cancel();
      const utter = new global.SpeechSynthesisUtterance(trimmed);
      global.speechSynthesis.speak(utter);
    }
  }

  function renderPreviewCards(container, previewData, opts = {}) {
    if (!container || !previewData?.preview) return;
    const { inbound, outbound, activeOpener } = previewData.preview;
    const live = previewData.live_opener || activeOpener;
    const liveText = live?.text || inbound?.text || '—';
    const showLive = opts.showLive !== false;
    const syncNote =
      previewData.sync_status && previewData.sync_status !== 'synced'
        ? '<p class="va-preview-sync-warn" role="status">Changes apply after sync completes.</p>'
        : '';
    const playBtn = showLive
      ? `<button type="button" class="va-preview-play-btn" data-preview-play aria-label="Play live opener">▶ Play live opener</button>`
      : '';
    container.innerHTML = `
      <div class="va-preview-grid">
        ${
          showLive
            ? `<div class="va-preview-card va-preview-card--live" aria-label="Live call opener">
          <div class="va-field-label">Live opener — matches inbound calls</div>
          <p class="va-preview-text" data-live-opener-text>${escapeHtml(liveText)}</p>
          ${playBtn}
        </div>`
            : ''
        }
        <div class="va-preview-card" aria-label="Inbound call preview">
          <div class="va-field-label">Inbound — saved greeting</div>
          <p class="va-preview-text">${escapeHtml(inbound?.text || '—')}</p>
        </div>
        <div class="va-preview-card" aria-label="Outbound call preview">
          <div class="va-field-label">Outbound — call start script</div>
          <p class="va-preview-text">${
            outbound?.enabled
              ? escapeHtml(outbound?.text || '—')
              : '<em>Outbound disabled</em>'
          }</p>
        </div>
      </div>
      ${syncNote}
    `;
    const playEl = container.querySelector('[data-preview-play]');
    if (playEl) {
      playEl.addEventListener('click', () => {
        const t = container.querySelector('[data-live-opener-text]')?.textContent || liveText;
        playLiveOpener(t);
      });
    }
  }

  global.VoicePreview = {
    fetchPreview,
    renderPreviewCards,
    playLiveOpener,
    escapeHtml
  };
})(typeof window !== 'undefined' ? window : global);
