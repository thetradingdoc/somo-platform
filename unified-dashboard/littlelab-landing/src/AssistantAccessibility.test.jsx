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
    manualBarcodeInput: '',
    setManualBarcodeInput: () => {},
    onManualBarcodeSubmit: () => {},
    manualIngredientsInput: '',
    setManualIngredientsInput: () => {},
    onManualIngredientsSubmit: () => {},
    onUploadIngredientPhoto: () => {},
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
  expect(screen.getByRole('textbox')).toBeInTheDocument();
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
      onRefresh={() => {}}
      onSaveEdit={async () => {}}
    />
  );
  expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

