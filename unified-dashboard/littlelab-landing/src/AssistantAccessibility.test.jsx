import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import AssistantVoicePage from './AssistantVoicePage';
import AssistantResultsPage from './AssistantResultsPage';

expect.extend(toHaveNoViolations);

function voiceProps(overrides = {}) {
  return {
    onClose: () => {},
    onOpenChat: () => {},
    onOpenUpload: () => {},
    apiBase: 'http://localhost:4000',
    voiceActive: false,
    sending: false,
    toggleVoice: () => {},
    prefersReducedMotion: true,
    speechLevelRef: { current: 0 },
    spherePaused: false,
    liveKit: { inSession: true, entryStep: 'session', cameraEnabled: true, setCameraOn: () => {} },
    localVideoRef: { current: null },
    remoteVideoContainerRef: { current: null },
    productTrackingActive: true,
    scanUi: { status: 'scanning', barcode: '', productName: '', reason: '' },
    scanResult: null,
    manualIngredientsInput: '',
    setManualIngredientsInput: () => {},
    onManualIngredientsSubmit: () => {},
    onUploadIngredientPhoto: () => {},
    onRequestScanAnalysis: () => {},
    ocrBusy: false,
    ocrError: '',
    pendingScanDecision: null,
    onResolvePendingScanDecision: () => {},
    onToggleScan: () => {},
    ...overrides
  };
}

test('scanner controls expose accessible names and order', async () => {
  const { container } = render(<AssistantVoicePage {...voiceProps()} />);
  expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /talk/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test('results page has basic landmark semantics and labels', async () => {
  const { container } = render(
    <AssistantResultsPage
      snapshot={{
        schema_version: '1.0',
        primary_concern: 'redness',
        confidence: { global: 0.7 },
        routine_conflicts: [],
        image_url: ''
      }}
      onBack={() => {}}
      onClose={() => {}}
      onAskKelly={() => {}}
    />
  );
  expect(screen.getByRole('button', { name: /^Done$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Ask Agent/i })).toBeInTheDocument();
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test('results page with summary tiles and verdict has no obvious a11y regressions', async () => {
  const { container } = render(
    <AssistantResultsPage
      snapshot={{
        schema_version: '1.0',
        confidence: { global: 0.62 },
        scan_summary: {
          tiles: {
            key_actives: { status: 'available', source: 'deterministic', confidence: 'medium', value: [{ display: 'Niacinamide' }] },
            formulation: { status: 'available', source: 'deterministic', confidence: 'low', value: 'Water-Based' },
            function: { status: 'available', source: 'deterministic', confidence: 'medium', value: ['hydration'] },
            skin_type: { status: 'deferred', source: 'none', reason_unavailable: 'no_profile_context' },
            safety_score: { status: 'deferred', source: 'none', reason_unavailable: 'no_scoring_pipeline' }
          }
        },
        result_summary: {
          disclaimer: 'informational_only',
          verdict: {
            product_overview: { what_it_does: 'Topical care.' },
            good_for_me: { answer: 'unknown' },
            harmful: { severity: 'low' },
            children_safe: { answer: 'insufficient_data', summary: 'Limited deterministic signal.' },
            side_effects: { summary: 'Not assessed in this scan.' },
            alternatives: { status: 'deferred', reason_unavailable: 'insufficient_data' }
          }
        }
      }}
      onBack={() => {}}
      onClose={() => {}}
      onAskKelly={() => {}}
    />
  );
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

