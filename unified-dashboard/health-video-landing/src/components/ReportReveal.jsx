import { Link } from 'react-router-dom';
import SomoLogo from './brand/SomoLogo.jsx';
import BtnPrimary from './brand/BtnPrimary.jsx';
import { formatRichReport, hasThinReport } from '../lib/reportFormatters.js';

export default function ReportReveal({
  report,
  onWhatsApp,
  onSms,
  onPrint,
  onReset
}) {
  if (!report) {
    return (
      <div className="hv-report-body">
        <p>Session ended. No report was available.</p>
        <BtnPrimary style={{ marginTop: 20 }} onClick={onReset}>Start another session</BtnPrimary>
      </div>
    );
  }

  const thin = hasThinReport(report);
  const rich = formatRichReport(report);
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  return (
    <>
      <div className="hv-report-body" id="hv-report-print">
        <div className="hv-report-header-block">
          <h1 className="hv-report-title">Your health chat summary</h1>
          <p className="hv-report-meta">{dateStr} · Educational only — not a diagnosis</p>
        </div>

        {thin ? (
          <>
            <div className="hv-report-section-label">What you told Kelly</div>
            <p className="hv-report-section-text">
              {report.transcript_excerpt || 'We could not build a full summary from this session.'}
            </p>
          </>
        ) : (
          <>
            {rich.symptomTags?.length > 0 && (
              <>
                <div className="hv-report-section-label">Symptoms discussed</div>
                <div className="hv-report-tags">
                  {rich.symptomTags.map((tag) => (
                    <span key={tag} className="hv-report-tag-pill">{tag}</span>
                  ))}
                </div>
              </>
            )}

            <div className="hv-report-section-label">What you told Kelly</div>
            <p className="hv-report-section-text">{rich.toldKelly}</p>

            {rich.timeline?.length > 0 && (
              <>
                <div className="hv-report-section-label">Timeline</div>
                <dl className="hv-report-timeline">
                  {rich.timeline.map((row) => (
                    <div key={row.label} className="hv-report-timeline-row">
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            <div className="hv-report-section-label">What Kelly noticed</div>
            <p className="hv-report-section-text">{rich.kellyNoticed}</p>

            {rich.citations?.length > 0 && (
              <>
                <div className="hv-report-section-label">Sources</div>
                <ul className="hv-report-citations">
                  {rich.citations.map((cite) => (
                    <li key={cite}>{cite}</li>
                  ))}
                </ul>
              </>
            )}

            {rich.escalation && (
              <div className="hv-report-escalation">
                <strong>{rich.escalation.title}</strong>
                <p>{rich.escalation.body}</p>
              </div>
            )}

            <div className="hv-report-section-label">What to do next</div>
            <p className="hv-report-section-text">{rich.nextSteps}</p>
          </>
        )}

        {report.safety_flags?.length > 0 && (
          <p className="hv-report-tag warn">Safety guidance was discussed</p>
        )}
      </div>

      <div className="hv-share-bar">
        <button type="button" className="hv-share-btn primary" onClick={onWhatsApp}>
          WhatsApp
        </button>
        <button type="button" className="hv-share-btn outline" onClick={onSms}>
          SMS
        </button>
        <button type="button" className="hv-share-btn outline" onClick={onPrint}>
          Save PDF
        </button>
      </div>
      <div className="hv-report-actions">
        <Link to="/" className="hv-journey-btn hv-journey-btn-secondary" style={{ textDecoration: 'none' }} onClick={onReset}>
          Start another session
        </Link>
      </div>
    </>
  );
}

export function ReportShell({ children }) {
  return (
    <div className="hv-report-screen">
      <div className="hv-report-frame">
        <header className="hv-report-nav">
          <SomoLogo variant="light" size="nav" />
          <span className="hv-journey-nav-label">Your report</span>
        </header>
        {children}
      </div>
    </div>
  );
}
