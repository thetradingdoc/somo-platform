import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantChatPage from './AssistantChatPage';

function buildProps(overrides = {}) {
  return {
    onBack: () => {},
    onClose: () => {},
    messages: [{ id: '1', role: 'assistant', text: 'Hello' }],
    input: '',
    setInput: () => {},
    attachments: [],
    setAttachments: () => {},
    sending: false,
    sendUserMessage: () => {},
    cameraRef: { current: null },
    imageRef: { current: null },
    fileRef: { current: null },
    speechLevelRef: { current: 0 },
    prefersReducedMotion: true,
    spherePaused: false,
    liveKit: {},
    localVideoRef: { current: null },
    remoteVideoContainerRef: { current: null },
    ...overrides
  };
}

test('shows pinned product context in chat handoff', () => {
  render(
    <AssistantChatPage
      {...buildProps({
        scanResult: {
          barcode: '12345678',
          dataSource: 'live_api',
          product: { product_name: 'Alpha Serum' }
        }
      })}
    />
  );
  expect(screen.getByText(/Pinned product: Alpha Serum/i)).toBeInTheDocument();
});

test('shows reset/refine/compare controls when pending decision exists', () => {
  const handler = jest.fn();
  render(
    <AssistantChatPage
      {...buildProps({
        pendingScanDecision: { previous: { barcode: '1' }, next: { barcode: '2' } },
        onResolvePendingScanDecision: handler
      })}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compare A vs B' }));
  expect(handler).toHaveBeenCalledWith('compare');
  fireEvent.click(screen.getByRole('button', { name: 'Refine' }));
  expect(handler).toHaveBeenCalledWith('refine');
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(handler).toHaveBeenCalledWith('reset');
});

