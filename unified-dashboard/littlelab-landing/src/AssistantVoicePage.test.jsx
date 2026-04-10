import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantVoicePage from './AssistantVoicePage';

function props(overrides = {}) {
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
    productTrackingActive: false,
    scanUi: { status: 'idle', barcode: '', productName: '', reason: '' },
    scanResult: null,
    manualBarcodeInput: '',
    setManualBarcodeInput: () => {},
    onManualBarcodeSubmit: () => {},
    manualIngredientsInput: '',
    setManualIngredientsInput: () => {},
    onManualIngredientsSubmit: () => {},
    pendingScanDecision: null,
    onResolvePendingScanDecision: () => {},
    onToggleScan: () => {},
    ...overrides
  };
}

test('surfaces provenance/category/sparse labels', () => {
  render(
    <AssistantVoicePage
      {...props({
        scanResult: {
          quality: { tier: 'partial', analyzeEnabled: true, analyzeLabel: 'Analyze with partial profile', summary: 'Partial profile' },
          dataSource: 'obf_index_cache',
          categoryRoute: 'hygiene',
          ingredientFlags: { hasIngredients: false },
          sparseData: true
        }
      })}
    />
  );
  expect(screen.getByText(/Source: obf_index_cache/i)).toBeInTheDocument();
  expect(screen.getByText(/Category: hygiene/i)).toBeInTheDocument();
  expect(screen.getByText(/Sparse data/i)).toBeInTheDocument();
});

test('pending decision controls call compare/refine/reset', () => {
  const onResolve = jest.fn();
  render(<AssistantVoicePage {...props({ pendingScanDecision: { previous: {}, next: {} }, onResolvePendingScanDecision: onResolve })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare A vs B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refine' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(onResolve).toHaveBeenCalledWith('compare');
  expect(onResolve).toHaveBeenCalledWith('refine');
  expect(onResolve).toHaveBeenCalledWith('reset');
});

