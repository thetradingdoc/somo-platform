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

  function renderPreviewCards(container, previewData) {
    if (!container || !previewData?.preview) return;
    const { inbound, outbound } = previewData.preview;
    const syncNote =
      previewData.sync_status && previewData.sync_status !== 'synced'
        ? '<p class="va-preview-sync-warn" role="status">Changes apply after sync completes.</p>'
        : '';
    container.innerHTML = `
      <div class="va-preview-grid">
        <div class="va-preview-card" aria-label="Inbound call preview">
          <div class="va-field-label">Inbound — what callers hear</div>
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
  }

  global.VoicePreview = {
    fetchPreview,
    renderPreviewCards,
    escapeHtml
  };
})(typeof window !== 'undefined' ? window : global);
