import React, { useEffect, useState } from 'react';
import { fetchFunnelSpecialists } from '../../lib/funnelApi';
import { getZip } from '../../lib/funnelSession';

export default function FunnelSpecialistList({
  match,
  zip: zipProp,
  onSave,
  onBack,
  onChangeZip,
  onTrackWhileFinding,
}) {
  const [zip, setZip] = useState(() => zipProp || getZip() || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
    if (z.length < 3) {
      setLoading(false);
      setData({ providers: [], disclaimer: '', data_status: 'zip_required' });
      return undefined;
    }
    setLoading(true);
    setError('');
    fetchFunnelSpecialists(z)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Could not load specialists');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [zip]);

  const urgent = match?.urgency === 'high' || match?.emergency;

  return (
    <div className="funnel-card funnel-card--age">
      {urgent && match?.copy ? (
        <div className="funnel-urgency-banner" role="alert">
          {match.copy}
        </div>
      ) : null}

      <label htmlFor="spec-zip" className="funnel-age-field-label">
        ZIP code
      </label>
      <input
        id="spec-zip"
        className="funnel-input funnel-input--zip"
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={zip}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 5);
          setZip(v);
          onChangeZip?.(v);
        }}
      />

      {loading ? <p className="funnel-analyzing-text">Loading specialists…</p> : null}
      {error ? <p className="funnel-error">{error}</p> : null}

      {!loading && !error && data?.providers?.length === 0 ? (
        <p className="funnel-preview-body">
          No specialists found for this US ZIP yet. Try a nearby US ZIP. International search is not available
          yet — save your email and we&apos;ll help you explore options in the app.
        </p>
      ) : null}

      {!loading && data?.providers?.length > 0 ? (
        <ul className="funnel-specialist-list">
          {data.providers.map((p) => (
            <li key={p.npi} className="funnel-specialist-card">
              <p className="funnel-specialist-name">
                {p.name}
                {p.credential ? `, ${p.credential}` : ''}
              </p>
              {p.specialty ? (
                <p className="funnel-specialist-meta">{p.specialty}</p>
              ) : null}
              <p className="funnel-specialist-meta">
                {[p.city, p.state, p.zip].filter(Boolean).join(', ')}
              </p>
              {p.phone ? <p className="funnel-specialist-phone">{p.phone}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="funnel-specialist-disclaimer">
        {data?.disclaimer ||
          'Directory information only. Booking is not guaranteed on Skin & Care. Confirm availability with the practice.'}
      </p>

      <div className="funnel-card-actions funnel-card-actions--stacked">
        <button type="button" className="funnel-btn" onClick={onSave}>
          Save and continue
        </button>
        {onTrackWhileFinding ? (
          <button type="button" className="funnel-btn funnel-btn-secondary" onClick={onTrackWhileFinding}>
            Track while I find a derm
          </button>
        ) : null}
        <button type="button" className="funnel-btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
