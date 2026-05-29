import React, { useEffect, useState } from 'react';
import { fetchFunnelSpecialists, fetchRoutinePreview } from '../../lib/funnelApi';
import { getZip } from '../../lib/funnelSession';
import { concernChipLabel } from './funnelConcernLabels';

export default function FunnelDualOffer({ match, concernId, onStartTracking, onSave, onBack }) {
  const [zip, setZip] = useState(() => getZip() || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [specialists, setSpecialists] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
    setLoading(true);
    setError('');
    Promise.all([
      z.length >= 3 ? fetchFunnelSpecialists(z, 8) : Promise.resolve({ providers: [] }),
      concernId ? fetchRoutinePreview(concernId) : Promise.resolve(null),
    ])
      .then(([spec, prev]) => {
        if (cancelled) return;
        setSpecialists(spec);
        setPreview(prev);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Could not load');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [zip, concernId]);

  const label = concernChipLabel(concernId);

  return (
    <div className="funnel-dual-wrap">
      <div className="funnel-card funnel-card--age">
        <p className="funnel-preview-kicker">Your tracking plan</p>
        <p className="funnel-preview-body">
          {match?.copy || `Start ${label} while you find a specialist.`}
        </p>
        {preview?.week_one?.expect ? (
          <p className="funnel-preview-body funnel-dual-expect">{preview.week_one.expect}</p>
        ) : null}
        <div className="funnel-card-actions funnel-card-actions--stacked">
          <button type="button" className="funnel-btn" onClick={onStartTracking}>
            Start tracking this plan
          </button>
        </div>
      </div>

      <div className="funnel-card funnel-card--age">
        <p className="funnel-preview-kicker">Specialists near you</p>
        <label htmlFor="dual-zip" className="funnel-age-field-label">
          ZIP code
        </label>
        <input
          id="dual-zip"
          className="funnel-input funnel-input--zip"
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
        />
        {loading ? <p className="funnel-analyzing-text">Loading…</p> : null}
        {error ? <p className="funnel-error">{error}</p> : null}
        {!loading && specialists?.providers?.length > 0 ? (
          <ul className="funnel-specialist-list funnel-specialist-list--compact">
            {specialists.providers.slice(0, 5).map((p) => (
              <li key={p.npi} className="funnel-specialist-card">
                <p className="funnel-specialist-name">
                  {p.name}
                  {p.credential ? `, ${p.credential}` : ''}
                </p>
                <p className="funnel-specialist-meta">
                  {[p.city, p.state].filter(Boolean).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="funnel-specialist-disclaimer">
          {specialists?.disclaimer || 'Directory information only — not medical advice.'}
        </p>
        <div className="funnel-card-actions funnel-card-actions--stacked">
          <button type="button" className="funnel-btn funnel-btn-secondary" onClick={onSave}>
            Save progress
          </button>
          <button type="button" className="funnel-btn-ghost" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
