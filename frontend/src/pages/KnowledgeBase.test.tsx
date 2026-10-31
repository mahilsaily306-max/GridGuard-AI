import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeBasePage } from './KnowledgeBase'

const entries = [
  {
    id: 'KB-REF-001',
    entry_type: 'reference_guidance',
    title: 'What a distribution transformer does',
    category: 'Transformer Fundamentals',
    simple_explanation: 'A distribution transformer reduces feeder voltage.',
    warning_signs: ['Repeated local supply interruptions'],
    possible_causes: ['Overload'],
    relevant_measurements: ['Load percentage'],
    safe_inspection_considerations: ['Inspection must be performed by qualified personnel.'],
    preventive_recommendations: ['Review loading and maintenance history together.'],
    source_classification: 'Demo Knowledge / Reference Guidance',
    created_at: '2026-10-31T00:00:00Z',
  },
  {
    id: 'KB-VER-0001',
    entry_type: 'verified_repair',
    title: 'Loose connection — T-101',
    category: 'Loose connection',
    simple_explanation: 'Loose termination',
    warning_signs: ['Heat discoloration'],
    possible_causes: ['Loose termination'],
    relevant_measurements: [],
    safe_inspection_considerations: ['Use the approved work order.'],
    preventive_recommendations: [],
    source_classification: 'Supervisor-Verified Repair Outcome',
    created_at: '2026-10-31T01:00:00Z',
    transformer_id: 'T-101',
    work_order_id: 7,
    repair_action: 'Repaired connector',
  },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><KnowledgeBasePage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(entries), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('KnowledgeBasePage', () => {
  it('keeps reference guidance separate from verified repair outcomes', async () => {
    renderPage()

    await waitFor(() => expect(screen.getAllByText('What a distribution transformer does').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Demo Knowledge / Reference Guidance').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Supervisor-Verified Repair Outcome').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Loose connection — T-101').length).toBeGreaterThan(0)
  })

  it('requests server-side search and category filters', async () => {
    renderPage()
    await waitFor(() => expect(vi.mocked(window.fetch)).toHaveBeenCalled())

    fireEvent.change(screen.getByPlaceholderText('Search knowledge'), { target: { value: 'rainfall' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by category' }), { target: { value: 'Condition Monitoring' } })

    await waitFor(() => {
      const urls = vi.mocked(window.fetch).mock.calls.map(call => String(call[0]))
      expect(urls.some(url => url.includes('query=rainfall') && url.includes('category=Condition+Monitoring'))).toBe(true)
    })
  })
})
