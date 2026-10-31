import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelEvaluationPage } from './ModelEvaluation'

const metrics = {
  model_version: 'rf-synthetic-v1',
  model_type: 'RandomForestClassifier',
  generator_version: 'synthetic-grid-v1',
  data_source: 'synthetic',
  evaluation_note: 'Held-out later chronological block with a 24-hour gap; synthetic performance is not field accuracy.',
  split: {
    strategy: 'chronological_with_24h_gap',
    train_rows: 55272,
    test_rows: 12120,
    train_end: '2026-10-06T23:00:00+00:00',
    test_start: '2026-10-08T00:00:00+00:00',
  },
  class_balance: { train_positive_rate: 0.248209, test_positive_rate: 0.252393 },
  random_forest: {
    precision: 0.373946,
    recall: 0.478588,
    f1: 0.419845,
    pr_auc: 0.363528,
    confusion_matrix: [[6610, 2451], [1595, 1464]],
  },
  threshold_baseline: {
    precision: 0.32115,
    recall: 0.295848,
    f1: 0.30798,
    pr_auc: 0.272734,
    confusion_matrix: [[7148, 1913], [2154, 905]],
  },
  permutation_importance_held_out: [
    { feature: 'age_years', importance: 0.079893 },
    { feature: 'rainfall_mm', importance: -0.000193 },
  ],
  feature_order: ['age_years', 'rainfall_mm'],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ModelEvaluationPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(metrics), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ModelEvaluationPage', () => {
  it('renders only the persisted evaluation metrics and lineage', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('37.4%')).toBeTruthy())
    expect(screen.getByText('47.9%')).toBeTruthy()
    expect(screen.getByText('42.0%')).toBeTruthy()
    expect(screen.getByText('36.4%')).toBeTruthy()
    expect(screen.getByText('rf-synthetic-v1')).toBeTruthy()
    expect(screen.queryByText('Accuracy')).toBeNull()
    expect(screen.queryByText('ROC AUC')).toBeNull()
  })

  it('shows the required synthetic-data limitation and no fabricated evaluation date', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText(/No evaluation date is shown because none is recorded in the artifact/)).toBeTruthy())
    expect(screen.getByText(/This model is trained and evaluated using synthetic demonstration data/)).toBeTruthy()
    expect(screen.queryByText(/Evaluation date:/)).toBeNull()
  })

  it('labels confusion outcomes and lists only artifact features', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('True negatives')).toBeTruthy())
    expect(screen.getByText('False positives')).toBeTruthy()
    expect(screen.getByText('False negatives')).toBeTruthy()
    expect(screen.getByText('True positives')).toBeTruthy()
    expect(screen.getAllByText('Age Years').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rainfall Mm').length).toBeGreaterThan(0)
    expect(screen.queryByText('Voltage')).toBeNull()
  })
})
