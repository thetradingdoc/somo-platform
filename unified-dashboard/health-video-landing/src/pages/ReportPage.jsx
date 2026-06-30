import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReportReveal, { ReportShell } from '../components/ReportReveal.jsx';
import { useHealthSession } from '../lib/HealthSessionContext.jsx';
import { getReport } from '../lib/healthStorage.js';
import { buildShareText } from '../lib/reportFormatters.js';

export default function ReportPage() {
  const navigate = useNavigate();
  const { report: contextReport, setReport, reset } = useHealthSession();
  const [hydrated, setHydrated] = useState(false);
  const [report, setLocalReport] = useState(contextReport);

  useEffect(() => {
    if (contextReport) {
      setLocalReport(contextReport);
      setHydrated(true);
      return;
    }
    const stored = getReport();
    if (stored) {
      setLocalReport(stored);
      setReport(stored);
    }
    setHydrated(true);
  }, [contextReport, setReport]);

  useEffect(() => {
    if (hydrated && !report) {
      navigate('/', { replace: true });
    }
  }, [hydrated, report, navigate]);

  const shareText = report ? buildShareText(report) : '';

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
  };

  const handleSms = () => {
    window.location.href = `sms:?body=${encodeURIComponent(shareText)}`;
  };

  const handlePrint = () => {
    window.print();
  };

  if (!hydrated || !report) return null;

  return (
    <ReportShell>
      <ReportReveal
        report={report}
        onWhatsApp={handleWhatsApp}
        onSms={handleSms}
        onPrint={handlePrint}
        onReset={reset}
      />
    </ReportShell>
  );
}
