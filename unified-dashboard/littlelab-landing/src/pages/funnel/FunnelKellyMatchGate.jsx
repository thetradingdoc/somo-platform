import React, { useCallback, useEffect, useState } from 'react';
import { postFunnelIntake } from '../../lib/funnelApi';
import {
  getConcernChips,
  getConfirmedAge,
  getFaceRead,
  getFunnelIntakeProposal,
  getInquiry,
  getKellySessionId,
  getUserGoal,
  setConcernChips,
  setFunnelIntakeProposal,
  setInquiry,
  setKellySessionId,
} from '../../lib/funnelSession';
import { CONCERN_CHIP_LABELS, concernChipLabel } from './funnelConcernLabels';

export default function FunnelKellyMatchGate({
  capture,
  onProgram,
  onSpecialist,
  onClarify,
  onSpecialistZip,
  onBack,
  onError,
}) {
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [proposal, setProposal] = useState(() => getFunnelIntakeProposal());
  const [pickPrimary, setPickPrimary] = useState('');

  const runIntake = useCallback(
    async (userConfirmConcernId = null) => {
      setLoading(true);
      onError?.('');
      try {
        const out = await postFunnelIntake({
          inquiry: capture?.inquiry ?? getInquiry(),
          concern_chips: capture?.concern_chips ?? getConcernChips(),
          not_sure: !!capture?.not_sure,
          user_goal: getUserGoal(),
          face_read: getFaceRead(),
          confirmed_age: getConfirmedAge(),
          kelly_session_id: getKellySessionId() || null,
          user_confirm_concern_id: userConfirmConcernId,
        });
        setProposal(out);
        setFunnelIntakeProposal(out);
        if (out.kelly_session_id) setKellySessionId(out.kelly_session_id);
        if (out.primary_concern_id) setPickPrimary(out.primary_concern_id);
        return out;
      } catch (e) {
        onError?.(e.message || 'Could not validate your match');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [capture, onError],
  );

  useEffect(() => {
    const chips = capture?.concern_chips || [];
    setConcernChips(chips);
    setInquiry(capture?.inquiry || '');
    runIntake(null);
  }, [capture, runIntake]);

  async function handleConfirm() {
    const primary = pickPrimary || proposal?.primary_concern_id;
    if (proposal?.needs_user_confirm && !primary) {
      onError?.('Choose which concern to start with.');
      return;
    }
    setConfirming(true);
    onError?.('');
    try {
      let finalProposal = proposal;
      if (proposal?.needs_user_confirm && primary) {
        finalProposal = await runIntake(primary);
      }
      if (!finalProposal) return;

      const goal = getUserGoal();

      if (goal === 'find_specialist') {
        onSpecialistZip?.(finalProposal);
        return;
      }

      if (finalProposal.route === 'specialist') {
        if (getUserGoal() === 'find_specialist') {
          onSpecialistZip?.(finalProposal);
        } else {
          onSpecialist?.({
            route: 'specialist',
            concern_id: null,
            copy: finalProposal.copy,
            kelly_reply: finalProposal.kelly_reply,
            derm_intent: null,
          });
        }
        return;
      }

      if (finalProposal.route === 'clarify') {
        onClarify?.(
          finalProposal.match || {
            route: 'clarify',
            concern_id: null,
            copy: finalProposal.copy,
            next_questions: finalProposal.match?.next_questions,
          },
        );
        return;
      }

      if (finalProposal.route === 'program' && finalProposal.primary_concern_id) {
        onProgram?.({
          route: 'program',
          concern_id: finalProposal.primary_concern_id,
          secondary_concern_ids: finalProposal.secondary_concern_ids || [],
          confidence: finalProposal.confidence,
          copy: finalProposal.copy,
          kelly_reply: finalProposal.kelly_reply,
          kelly_session_id: finalProposal.kelly_session_id,
          intake_proposal: finalProposal,
          match: finalProposal.match,
        });
      }
    } finally {
      setConfirming(false);
    }
  }

  const chipOptions =
    (capture?.concern_chips?.length ? capture.concern_chips : getConcernChips()) || [];

  if (loading && !proposal) {
    return (
      <div className="funnel-card funnel-card--age">
        <div className="funnel-analyzing">
          <div className="funnel-analyzing-ring" aria-hidden="true" />
          <p className="funnel-analyzing-text">Kelly is reviewing your concerns…</p>
        </div>
      </div>
    );
  }

  const primaryLabel = proposal?.primary_concern_id
    ? CONCERN_CHIP_LABELS[proposal.primary_concern_id] || concernChipLabel(proposal.primary_concern_id)
    : null;
  const isFindSpecialist = getUserGoal() === 'find_specialist';
  const isSpecialistRoute = proposal?.route === 'specialist' || isFindSpecialist;
  const kellyReply = String(proposal?.kelly_reply || '').trim();
  const usCopy = String(proposal?.copy || '').trim();
  const showKellyReply = kellyReply.length > 0;
  const showUsCopy =
    isFindSpecialist && usCopy.length > 0 && (!showKellyReply || usCopy !== kellyReply);

  return (
    <div className="funnel-match-wrap funnel-kelly-gate">
      <div className="funnel-card funnel-card--age">
        <p className="funnel-triage-kicker">{isFindSpecialist ? 'Before we search' : 'Your match'}</p>
        {showKellyReply ? (
          <p className="funnel-preview-body funnel-kelly-gate-reply">{kellyReply}</p>
        ) : null}
        {showUsCopy ? <p className="funnel-photo-honest">{usCopy}</p> : null}
        {!isFindSpecialist && proposal?.copy && !showUsCopy ? (
          <p className="funnel-photo-honest">{proposal.copy}</p>
        ) : null}
        {primaryLabel && !isFindSpecialist ? (
          <p className="funnel-kelly-gate-primary">
            Recommended starting program: <strong>{primaryLabel}</strong>
          </p>
        ) : null}

        {proposal?.needs_user_confirm && chipOptions.length > 1 && !isFindSpecialist ? (
          <div className="funnel-kelly-gate-pick">
            <p className="funnel-age-field-label">Which bothers you most right now?</p>
            <div className="funnel-concern-grid" role="listbox" aria-label="Primary concern">
              {chipOptions.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`funnel-concern-chip${pickPrimary === id ? ' funnel-concern-chip--selected' : ''}`}
                  onClick={() => setPickPrimary(id)}
                >
                  {CONCERN_CHIP_LABELS[id] || concernChipLabel(id)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="funnel-card-actions funnel-card-actions--stacked">
          <button
            type="button"
            className="funnel-btn"
            disabled={loading || confirming}
            onClick={handleConfirm}
          >
            {confirming
              ? 'Continuing…'
              : isSpecialistRoute
                ? 'Continue to find specialists'
                : 'Looks right — see my plan'}
          </button>
          <button
            type="button"
            className="funnel-btn funnel-btn-secondary"
            disabled={loading || confirming}
            onClick={onBack}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
