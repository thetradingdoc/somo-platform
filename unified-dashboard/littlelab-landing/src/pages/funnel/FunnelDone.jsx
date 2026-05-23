import React, { useEffect, useState } from 'react';
import { createPatientAuthHandoff } from '../../lib/funnelApi';
import { getMatchResult, getPatientSessionId } from '../../lib/funnelSession';
import { concernChipLabel } from './funnelConcernLabels';

export default function FunnelDone({ concernId, saved }) {
  const [handoffHref, setHandoffHref] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const sessionId = getPatientSessionId();
  const match = getMatchResult();
  const route = match?.route;
  const hasTemplate = saved && concernId && (route === 'program' || route === 'dual');
  const concernLabel = concernId ? concernChipLabel(concernId) : 'Skin & Care';

  const todayHref = sessionId
    ? '/patients/patient-dashboard.html'
    : '/patients/patient-login.html';

  useEffect(() => {
    if (!sessionId) {
      setHandoffNote('Sign in on the web with the same email to pick up your program.');
      return;
    }
    let cancelled = false;
    createPatientAuthHandoff(sessionId)
      .then((data) => {
        if (cancelled) return;
        const ticket = data?.ticket;
        if (ticket) {
          setHandoffHref(`patientapp://auth?ticket=${encodeURIComponent(ticket)}`);
          setHandoffNote(
            'Open the app on your phone, or log your first photo on the web below.',
          );
        } else {
          setHandoffNote('Open the Skin & Care app and sign in with the same email if prompted.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHandoffNote('Open the Skin & Care app and sign in with the same email.');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="funnel-card funnel-card--age funnel-card--age-complete">
      <div className="funnel-complete-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <p className="funnel-age-label">{saved ? 'Program saved' : 'Ready when you are'}</p>
      <p className="funnel-age-reaction funnel-age-reaction--hit">
        {hasTemplate
          ? `Your ${concernLabel} is active — log today's progress photo to complete day 1.`
          : saved
            ? 'Your specialist list is saved. Start a tracking plan anytime from the app.'
            : concernId
              ? `Your ${concernLabel} preview is ready — sign in anytime to save it.`
              : 'Sign in anytime to save your progress.'}
      </p>
      {handoffNote ? <p className="funnel-handoff-note">{handoffNote}</p> : null}
      <div className="funnel-card-actions funnel-card-actions--stacked funnel-done-actions">
        {hasTemplate ? (
          <a href={todayHref} className="funnel-btn">
            Log today&apos;s photo
          </a>
        ) : null}
        {handoffHref ? (
          <a href={handoffHref} className={`funnel-btn${hasTemplate ? ' funnel-btn-secondary' : ''}`}>
            Get the app
          </a>
        ) : (
          <a
            href="/patients/patient-login.html?intent=signup"
            className={`funnel-btn${hasTemplate ? ' funnel-btn-secondary' : ''}`}
          >
            Get the app
          </a>
        )}
        <a href={todayHref} className="funnel-btn-ghost">
          Continue on web
        </a>
      </div>
      <p className="funnel-card-disc">
        Wellness guidance only — not medical advice.
      </p>
    </div>
  );
}
