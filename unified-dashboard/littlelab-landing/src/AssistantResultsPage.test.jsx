/**
 * AssistantResultsPage — verdict-first layout, conflicts, chips, waitlist CTA.
 * Run: npm test -- --testPathPattern="AssistantResultsPage"
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssistantResultsPage from './AssistantResultsPage';

const noop = () => {};

function makeSnapshot(overrides = {}) {
  return {
    schema_version: '1.0',
    confidence: { global: 0.62 },
    ...overrides
  };
}

describe('AssistantResultsPage', () => {
  test('hero uses image_ingredients_url when front image fields are absent', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Snack Bar',
            image_ingredients_url: 'https://example.com/ingredients.jpg',
            ingredients_text: 'Oats, sugar'
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    const img = screen.getByRole('img', { name: /Snack Bar/i });
    expect(img).toHaveAttribute('src', 'https://example.com/ingredients.jpg');
  });

  test('hero uses image_front_url when image_url is absent', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Apple Juice',
            image_front_url: 'https://example.com/front.jpg',
            ingredients_text: 'Water, apple juice concentrate'
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    const img = screen.getByRole('img', { name: /Apple Juice/i });
    expect(img).toHaveAttribute('src', 'https://example.com/front.jpg');
  });

  test('hero uses product.image_url when scanned_product has no image fields', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Apple Juice',
            ingredients_text: 'Water'
          },
          product: { image_url: 'https://example.com/from-merge.jpg' }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    const img = screen.getByRole('img', { name: /Apple Juice/i });
    expect(img).toHaveAttribute('src', 'https://example.com/from-merge.jpg');
  });

  test('renders hero with product name and confidence', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Glow Serum',
            image_url: 'https://example.com/img.jpg',
            ingredients_text: 'Aqua, Niacinamide'
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getAllByText('Glow Serum').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Confidence 62%/).length).toBeGreaterThan(0);
  });

  test('maps graph conflicts with ingredient_canonical_ids to pair layout', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Test',
            ingredients_text: 'Aqua',
            ingredient_graph_conflicts: [
              {
                id: 'g1',
                severity: 'high',
                summary: 'Do not layer',
                recommendation: 'Alternate nights.',
                ingredient_canonical_ids: ['cosing:retinol', 'cosing:glycolic_acid']
              }
            ]
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Conflict detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Retinol/i)).toBeInTheDocument();
    expect(screen.getByText(/Glycolic Acid/i)).toBeInTheDocument();
    expect(screen.getByText(/Do not layer/)).toBeInTheDocument();
  });

  test('summary-only conflict renders without ingredient pills', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          routine_conflicts: [
            { id: 'h1', severity: 'medium', summary: 'Barrier stress with strong actives.', recommendation: 'Pause acids.' }
          ]
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Barrier stress with strong actives/)).toBeInTheDocument();
  });

  test('merges scan and routine conflicts without dropping routine when scan array is empty', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'X',
            ingredients_text: 'Water',
            ingredient_graph_conflicts: []
          },
          routine_conflicts: [{ id: 'r1', severity: 'high', summary: 'Routine-level note' }]
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Routine-level note/)).toBeInTheDocument();
  });

  test('Ask Agent invokes onAskKelly', () => {
    const onAskKelly = jest.fn();
    render(<AssistantResultsPage snapshot={makeSnapshot()} onClose={noop} onAskKelly={onAskKelly} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Agent/i }));
    expect(onAskKelly).toHaveBeenCalledTimes(1);
  });

  test('header back uses onBack when provided', () => {
    const onBack = jest.fn();
    const onClose = jest.fn();
    render(<AssistantResultsPage snapshot={makeSnapshot()} onBack={onBack} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Go back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('shows not-found banner when lookup_status is not_found', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: { lookup_status: 'not_found', barcode: '123' }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Not in catalog/i)).toBeInTheDocument();
  });

  test('shows catalog ingredient list and OFF source for food-like products without skincare chips', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            source: 'open_food_facts',
            product_name: 'Purified Drinking Water',
            ingredients_text: 'Water, calcium chloride, sodium bicarbonate',
            barcode: '0096619756803'
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/^Food & beverage$/)).toBeInTheDocument();
    const listRegion = screen.getByRole('region', { name: /Catalog ingredient list/i });
    expect(listRegion).toBeInTheDocument();
    expect(within(listRegion).getByText(/Open Food Facts/i)).toBeInTheDocument();
    expect(within(listRegion).getByText(/calcium chloride/i)).toBeInTheDocument();
  });

  test('Works for you chips when beneficial ingredients match', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Serum',
            ingredients_text: 'Aqua, Niacinamide, Glycerin'
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Works for you/i)).toBeInTheDocument();
    expect(screen.getByText('Niacinamide')).toBeInTheDocument();
  });

  test('renders NYC reference section when nyc_metal_context is present', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            product_name: 'Turmeric Powder',
            ingredients_text: 'turmeric',
            nyc_metal_context: {
              source: 'nyc_health_dept_consumer_metal_tests',
              dataset_version: 'test',
              match_tier: 'moderate',
              disclaimer: 'NYC Health Department historical lab tests (reference only).',
              summary: 'Matched rows by product-name similarity. Ingredient disclosure is not a metals lab report.',
              metals: [{ metal: 'Lead', n_rows: 2, n_not_detected: 0, n_reported: 2, max_ppm: 610 }],
              sample_rows: [
                {
                  product_name: 'Turmeric powder',
                  metal: 'Lead',
                  ppm: 2.9,
                  not_detected: false,
                  collection_date: '01/04/2011'
                }
              ]
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    const region = screen.getByRole('region', { name: /NYC Health Department reference metal tests/i });
    expect(region).toBeInTheDocument();
    expect(within(region).getByText(/NYC reference/i)).toBeInTheDocument();
    expect(within(region).getByText(/610/)).toBeInTheDocument();
  });

  test('renders summary tiles from scan_summary envelope', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scan_summary: {
            tiles: {
              key_actives: { status: 'available', source: 'deterministic', confidence: 'medium', value: [{ display: 'Niacinamide 10%' }] },
              formulation: { status: 'available', source: 'deterministic', confidence: 'low', value: 'Water-Based' },
              function: { status: 'available', source: 'deterministic', confidence: 'medium', value: ['hydration'] },
              skin_type: { status: 'deferred', source: 'none', confidence: null, value: null, reason_unavailable: 'no_profile_context' },
              safety_score: { status: 'deferred', source: 'none', confidence: null, value: null, reason_unavailable: 'no_scoring_pipeline' }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    const tileRegion = screen.getByRole('region', { name: /Structured summary tiles/i });
    expect(tileRegion).toBeInTheDocument();
    expect(screen.getAllByText(/Niacinamide 10%/i).length).toBeGreaterThan(0);
    expect(within(tileRegion).getByText(/Needs profile context/i)).toBeInTheDocument();
    expect(within(tileRegion).queryByText(/no_profile_context/i)).not.toBeInTheDocument();
  });

  test('renders result_summary verdict block with disclaimer', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            disclaimer: 'informational_only',
            tiles: {},
            verdict: {
              product_overview: { what_it_does: 'Helps with hydration.' },
              good_for_me: { answer: 'yes', summary: 'Fits your session context.' },
              harmful: { severity: 'low', flags: ['No fragrance allergens'], top_evidence: 'All flagged ingredients are within concern thresholds.' },
              children_safe: { answer: 'caution', summary: 'Use caution for young children.' },
              side_effects: { summary: 'Not assessed in this scan.' },
              alternatives: {
                status: 'available',
                candidates: ['Fragrance-free ceramide moisturizer']
              }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    const verdictRegion = screen.getByRole('region', { name: /Decision answers/i });
    expect(verdictRegion).toBeInTheDocument();
    expect(screen.getByText(/^Is this good for me\?$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Yes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Low risk$/i)).toBeInTheDocument();
    expect(screen.getByText(/All flagged ingredients are within concern thresholds/i)).toBeInTheDocument();
    expect(screen.getByText(/No fragrance allergens/i)).toBeInTheDocument();
    expect(screen.getByText(/^Good for children\?$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Caution$/i)).toBeInTheDocument();
    expect(screen.getByText(/Use caution for young children/i)).toBeInTheDocument();
    expect(screen.getByText(/^Side effects$/i)).toBeInTheDocument();
    expect(screen.getByText(/Side effect profile not yet assessed for this scan/i)).toBeInTheDocument();
    expect(screen.getByText(/^Alternatives I can use$/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 found$/i)).toBeInTheDocument();
    expect(screen.getByText(/Fragrance-free ceramide moisturizer/i)).toBeInTheDocument();
    expect(screen.getByText(/For informational guidance only/i)).toBeInTheDocument();
  });

  test('renders deterministic fallback verdict rows when reasoning verdict is absent', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scanned_product: {
            source: 'open_beauty_facts',
            category_route: 'cosmetic',
            product_name: 'Niacinamide Serum',
            ingredients_text: 'Water, Niacinamide, Phenoxyethanol'
          },
          scan_summary: {
            tiles: {
              function: { status: 'available', source: 'deterministic', value: ['oil control'] },
              key_actives: { status: 'available', source: 'deterministic', value: [{ display: 'Niacinamide 10%' }] }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByRole('region', { name: /Decision answers/i })).toBeInTheDocument();
    expect(screen.getByText(/^What does it do\?$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Supports oil control/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Deeper analysis running/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Ask Kelly for personalised alternatives/i })).toBeInTheDocument();
  });

  test('renders side-effects pending copy when not assessed', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            verdict: {
              side_effects: { summary: 'Not assessed in this scan.' }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Side effect profile not yet assessed for this scan/i)).toBeInTheDocument();
  });

  test('renders conversion layer prompts when missing_more present', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            missing_more: ['Unlock personal-fit mode', 'Enable pediatric profile'],
            tiles: {},
            verdict: {}
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByRole('region', { name: /Upgrade conversion layer/i })).toBeInTheDocument();
    expect(screen.getByText(/Unlock personal-fit mode/i)).toBeInTheDocument();
  });

  test('handles invalid/missing tile fields without crashing', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          scan_summary: { tiles: { key_actives: { status: 'available', value: null } } }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByRole('region', { name: /Structured summary tiles/i })).toBeInTheDocument();
  });

  test('shows See alternatives when verdict alternatives are available', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            reasoning: { enabled: true },
            tiles: {},
            verdict: {
              alternatives: {
                status: 'available',
                source: 'reasoning',
                reasoning: { confidence: 0.82 },
                candidates: ['Fragrance-free ceramide moisturizer']
              }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByRole('button', { name: /See alternatives/i })).toBeInTheDocument();
  });

  test('does not show See alternatives for deterministic-only alternatives', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            reasoning: { enabled: true },
            verdict: {
              alternatives: {
                status: 'available',
                source: 'deterministic',
                candidates: ['Fragrance-free ceramide moisturizer']
              }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.queryByRole('button', { name: /See alternatives/i })).not.toBeInTheDocument();
  });

  test('surfaces reasoning provenance in a why-this-answer panel', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            reasoning: {
              enabled: true,
              reasoning_model: 'reasoning-stub',
              reasoning_version: 'v1',
              reasoning_evidence_refs: ['pinecone:ingredient:niacinamide']
            },
            verdict: {
              good_for_me: {
                source: 'reasoning',
                answer: 'yes',
                summary: 'Reasoning-backed fit summary.',
                reasoning: {
                  confidence: 0.84,
                  reasoning_model: 'reasoning-stub',
                  reasoning_version: 'v1',
                  reasoning_evidence_refs: ['pinecone:ingredient:niacinamide']
                }
              }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Why this answer/i)).toBeInTheDocument();
    expect(screen.getByText(/Reasoning model reasoning-stub v1/i)).toBeInTheDocument();
    expect(screen.getByText(/Pinecone - Ingredient - Niacinamide/i)).toBeInTheDocument();
  });

  test('shows reasoning unavailable fallback when confidence is too low', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            reasoning: { enabled: true, status: 'deferred' },
            verdict: {
              harmful: {
                severity: 'low',
                reason_unavailable: 'reasoning_low_confidence'
              }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/confidence was too low/i)).toBeInTheDocument();
  });

  test('shows route-safe fallback when reasoning is unsupported for route', () => {
    render(
      <AssistantResultsPage
        snapshot={makeSnapshot({
          result_summary: {
            reasoning: { enabled: true, status: 'deferred' },
            verdict: {
              good_for_me: {
                status: 'unsupported_for_route',
                answer: 'unknown',
                summary: 'Deterministic fallback summary.',
                reason_unavailable: 'unsupported_for_route'
              }
            }
          }
        })}
        onClose={noop}
        onAskKelly={noop}
      />
    );
    expect(screen.getByText(/Reasoning skipped for this category route/i)).toBeInTheDocument();
  });
});
