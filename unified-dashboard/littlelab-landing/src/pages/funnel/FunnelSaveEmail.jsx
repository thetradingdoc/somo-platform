import React, { useRef, useState } from 'react';
import {
  activateRoutineTemplate,
  bridgeFunnelToKelly,
  confirmPatientVerifyCode,
  sendPatientVerifyCode,
} from '../../lib/funnelApi';
import {
  getConcernId,
  getFaceRead,
  getInquiry,
  getFunnelIntakeProposal,
  getKellySessionId,
  getMatchResult,
  getUserGoal,
  getZip,
  setPatientSessionId,
  syncPatientSessionToLocalStorage,
} from '../../lib/funnelSession';
import { concernChipLabel } from './funnelConcernLabels';

const CODE_LEN = 6;

export default function FunnelSaveEmail({ concernId, matchResult, onDone, onSkip }) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [digits, setDigits] = useState(Array(CODE_LEN).fill(''));
  const inputsRef = useRef([]);

  const cidResolved = concernId || getConcernId();
  const match = matchResult || getMatchResult();
  const route = match?.route;
  const activatesTemplate = cidResolved && (route === 'program' || route === 'dual');
  const concernLabel = cidResolved ? concernChipLabel(cidResolved) : 'Skin & Care';

  async function handleSend(e) {
    e?.preventDefault?.();
    const trimmed = String(email || '').trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setPhase('sending');
    try {
      await sendPatientVerifyCode(trimmed);
      setPhase('code_sent');
    } catch (err) {
      setPhase('idle');
      setError(err.message || 'Could not send code');
    }
  }

  function codeValue() {
    return digits.join('');
  }

  function handleDigitChange(index, value) {
    const v = String(value || '').replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = v;
    setDigits(next);
    if (v && index < CODE_LEN - 1) inputsRef.current[index + 1]?.focus();
  }

  function handleDigitKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  async function handleVerify(e) {
    e?.preventDefault?.();
    const code = codeValue();
    if (code.length !== CODE_LEN) {
      setError('Enter the full 6-digit code.');
      return;
    }
    setError('');
    setPhase('verifying');
    const cid = concernId || getConcernId();
    const match = matchResult || getMatchResult();
    const route = match?.route;
    const shouldActivate = cid && (route === 'program' || route === 'dual');
    try {
      const data = await confirmPatientVerifyCode(email, code);
      const sessionId = data.session_id;
      setPatientSessionId(sessionId);
      syncPatientSessionToLocalStorage(sessionId);
      if (shouldActivate) {
        await activateRoutineTemplate(cid, sessionId);
      }
      try {
        await bridgeFunnelToKelly(sessionId, {
          match_result: match,
          concern_id: cid || null,
          inquiry: getInquiry(),
          face_read: getFaceRead(),
          zip: getZip() || null,
          user_goal: getUserGoal(),
          route: route || null,
          companion_concern_id: match?.companion_concern_id || null,
          clarify_answers: match?.clarify_answers || null,
          secondary_concern_ids: match?.secondary_concern_ids || [],
          kelly_session_id: match?.kelly_session_id || getKellySessionId() || null,
          intake_proposal: match?.intake_proposal || getFunnelIntakeProposal() || null,
        });
      } catch (_) {
        /* bridge is best-effort for Kelly continuity */
      }
      setPhase('idle');
      onDone?.({ sessionId, email });
    } catch (err) {
      setPhase('code_sent');
      setError(err.message || 'Verification failed');
      setDigits(Array(CODE_LEN).fill(''));
      inputsRef.current[0]?.focus();
    }
  }

  return (
    <div className="funnel-card funnel-card--age funnel-save-email">
      <p className="funnel-save-subline">
        One email. No password.
        {activatesTemplate ? (
          <>
            {' '}
            We&apos;ll attach your <strong>{concernLabel}</strong> program.
          </>
        ) : (
          <> We&apos;ll save your email and specialist search — no program unless you start tracking.</>
        )}
      </p>
      <form onSubmit={phase === 'code_sent' || phase === 'verifying' ? handleVerify : handleSend}>
        <label htmlFor="funnel-email" className="funnel-age-field-label">
          Email
        </label>
        <input
          id="funnel-email"
          className="funnel-input"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          disabled={phase === 'verifying' || phase === 'code_sent'}
          onChange={(ev) => setEmail(ev.target.value)}
        />
        {phase === 'code_sent' || phase === 'verifying' ? (
          <>
            <p className="funnel-age-field-label" style={{ marginTop: 12 }}>
              6-digit code
            </p>
            <div className="funnel-code-row">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  className="funnel-code-digit"
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  aria-label={`Digit ${i + 1}`}
                  disabled={phase === 'verifying'}
                  onChange={(ev) => handleDigitChange(i, ev.target.value)}
                  onKeyDown={(ev) => handleDigitKeyDown(i, ev)}
                />
              ))}
            </div>
          </>
        ) : null}
        <div className="funnel-card-actions funnel-card-actions--stacked">
          <button
            type="submit"
            className="funnel-btn"
            disabled={phase === 'sending' || phase === 'verifying'}
          >
            {phase === 'sending'
              ? 'Sending…'
              : phase === 'verifying'
                ? 'Verifying…'
                : phase === 'code_sent'
                  ? 'Verify and continue'
                  : 'Send code'}
          </button>
          <button type="button" className="funnel-btn-ghost" onClick={() => onSkip?.()}>
            Continue without saving
          </button>
        </div>
      </form>
      {error ? <p className="funnel-error">{error}</p> : null}
    </div>
  );
}
