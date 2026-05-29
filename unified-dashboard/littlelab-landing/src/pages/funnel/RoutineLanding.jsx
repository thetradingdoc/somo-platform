import React from 'react';
import { Helmet } from 'react-helmet-async';
import FunnelBrandLockup from './FunnelBrandLockup';
import FunnelScOrb from './FunnelScOrb';
import SocialProofPill from './SocialProofPill';
import '../../funnel/landing-funnel.css';

export default function RoutineLanding() {
  return (
    <div className="funnel-root funnel-root--fullscreen">
      <Helmet>
        <title>Somo — Track your skincare routine</title>
        <meta
          name="description"
          content="Guess your skin age or sign up to track your personalized skincare routine in the app."
        />
      </Helmet>
      <header className="funnel-nav funnel-nav--wide">
        <FunnelBrandLockup />
        <nav className="funnel-nav-links" aria-label="Primary">
          <a href="/">Home</a>
          <a href="/patients/patient-login.html">Login</a>
        </nav>
      </header>
      <main className="funnel-hero funnel-hero--fullscreen">
        <div className="funnel-hero-visual" aria-hidden="true">
          <img
            className="hero-art hero-art--phone"
            src="/images/marketing/LP-Phone.svg"
            alt=""
          />
        </div>
        <div className="funnel-hero-copy">
          <SocialProofPill />
          <h1>
            Track your skincare
            <br />
            routine with ease
          </h1>
          <p className="lead">
            Estimate your biological age from a quick selfie, then build daily AM/PM habits, journal
            progress photos, and manage prescriptions and bills in one app.
          </p>
          <div className="funnel-hero-ctas">
            <a href="/start" className="funnel-btn">
              Guess my age
            </a>
            <a href="/patients/patient-login.html?intent=signup" className="funnel-btn funnel-btn-secondary">
              Signup
            </a>
          </div>
        </div>
      </main>
      <FunnelScOrb />
    </div>
  );
}
