import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/league-spartan/400.css';
import '@fontsource/league-spartan/600.css';
import '@fontsource/league-spartan/700.css';
import App from './App.jsx';
import { HealthSessionProvider } from './lib/HealthSessionContext.jsx';
import './styles/health-funnel.css';
import './styles/journey.css';
import './styles/live-session.css';
import './styles/session-mobile.css';
import './styles/session-desktop.css';
import './styles/marketing-landing.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/health-video">
      <HealthSessionProvider>
        <App />
      </HealthSessionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
