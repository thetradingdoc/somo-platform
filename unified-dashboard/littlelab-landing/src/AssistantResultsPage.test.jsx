import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantResultsPage from './AssistantResultsPage';

const baseSnapshot = {
  schema_version: '1.0',
  primary_concern: 'redness',
  confidence: { global: 0.62 },
  routine_conflicts: []
};

function renderPage(snapshot = {}, extra = {}) {
  return render(
    <AssistantResultsPage
      snapshot={{ ...baseSnapshot, ...snapshot }}
      onBack={() => {}}
      onClose={() => {}}
      onRefresh={() => {}}
      onSaveEdit={async () => {}}
      {...extra}
    />
  );
}

test('renders skeleton while loading', () => {
  renderPage({ image_url: 'https://img.local/p.png' }, { loading: true });
  expect(screen.getByLabelText('Loading product image')).toBeInTheDocument();
});

test('uses contain fit for extreme wide ratio', () => {
  renderPage({ image_url: 'https://img.local/p.png', ui_hints: { image_aspect_ratio: 2.2 } });
  const img = screen.getByAltText('Scanned product');
  expect(img.className).toContain('axr-hero-img--contain');
});

test('fallback card appears when image missing', () => {
  renderPage({ image_url: '' });
  expect(screen.getByLabelText('Product image unavailable')).toBeInTheDocument();
});

test('bottom action row has Fix Results and Done', () => {
  renderPage();
  expect(screen.getByRole('button', { name: 'Fix Results' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
});

test('fix results panel toggles from bottom action', () => {
  renderPage();
  expect(screen.queryByText('Routine conflicts (comma-separated)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fix Results' }));
  expect(screen.getByText('Routine conflicts (comma-separated)')).toBeInTheDocument();
});

test('progress strip reflects low/medium/high confidence', () => {
  const { rerender } = render(
    <AssistantResultsPage
      snapshot={{ ...baseSnapshot, confidence: { global: 0.2 } }}
      onBack={() => {}}
      onClose={() => {}}
      onRefresh={() => {}}
      onSaveEdit={async () => {}}
    />
  );
  expect(document.querySelector('.axr-progress-fill')?.className).toContain('axr-progress-fill--low');

  rerender(
    <AssistantResultsPage
      snapshot={{ ...baseSnapshot, confidence: { global: 0.5 } }}
      onBack={() => {}}
      onClose={() => {}}
      onRefresh={() => {}}
      onSaveEdit={async () => {}}
    />
  );
  expect(document.querySelector('.axr-progress-fill')?.className).toContain('axr-progress-fill--medium');

  rerender(
    <AssistantResultsPage
      snapshot={{ ...baseSnapshot, confidence: { global: 0.9 } }}
      onBack={() => {}}
      onClose={() => {}}
      onRefresh={() => {}}
      onSaveEdit={async () => {}}
    />
  );
  expect(document.querySelector('.axr-progress-fill')?.className).toContain('axr-progress-fill--high');
});

