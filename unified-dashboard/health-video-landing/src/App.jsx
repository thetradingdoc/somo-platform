import { Routes, Route, Navigate } from 'react-router-dom';

import MarketingLandingPage from './pages/MarketingLandingPage.jsx';
import LanguageStartPage from './pages/LanguageStartPage.jsx';
import NamePage from './pages/NamePage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import SessionPage from './pages/SessionPage.jsx';
import ReportPage from './pages/ReportPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MarketingLandingPage />} />
      <Route path="/start" element={<LanguageStartPage />} />
      <Route path="/name" element={<NamePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/session" element={<SessionPage />} />
      <Route path="/report" element={<ReportPage />} />
      <Route path="/consent" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
