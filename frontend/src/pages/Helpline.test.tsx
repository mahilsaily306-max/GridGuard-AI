import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HelplinePage } from './Helpline'

const transformers = [
  { id: 'T-101', village_name: 'Demo Village A', feeder_id: 'F-1', latitude: 30.7, longitude: 76.7, capacity_kva: 250, age_years: 5, status: 'operational', latest_prediction: { risk_score: 0.1, risk_level: 'low' }, latest_reading: { observed_at: '2026-10-31T00:00:00Z', load_pct: 40, oil_temp_c: 55, ambient_temp_c: 30 } },
  { id: 'T-102', village_name: 'Demo Village B', feeder_id: 'F-1', latitude: 30.8, longitude: 76.8, capacity_kva: 250, age_years: 6, status: 'operational', latest_prediction: { risk_score: 0.2, risk_level: 'low' }, latest_reading: { observed_at: '2026-10-31T00:00:00Z', load_pct: 45, oil_temp_c: 58, ambient_temp_c: 31 } },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/helpline']}><HelplinePage /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(transformers), { status: 200, headers: { 'content-type': 'application/json' } })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HelplinePage', () => {
  it('starts at the location step and advances through the flow', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Location & transformer')).toBeDefined())
    expect(screen.getByText('Issue type & severity')).toBeDefined()
    expect(screen.getByText('Review & submit')).toBeDefined()

    await waitFor(() => expect(screen.getByText(/T-102/)).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(screen.getByLabelText('Issue')).toBeDefined())
    fireEvent.change(screen.getByLabelText('Issue'), { target: { value: 'sparking_fire' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(screen.getByLabelText('Landmark')).toBeDefined())
    expect(screen.queryByLabelText('Issue')).toBeNull()

    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Sparking seen near the pole.' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(screen.getByText('Review & submit')).toBeDefined())
    expect(screen.getByText('Sparking or fire')).toBeDefined()
    expect(screen.getByText('Sparking seen near the pole.')).toBeDefined()
  })

  it('going back preserves form data without clearing it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Transformer / village')).toBeDefined())
    await waitFor(() => expect(screen.getByText(/T-102/)).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByLabelText('Issue')).toBeDefined())

    fireEvent.change(screen.getByLabelText('Issue'), { target: { value: 'fallen_wires' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'emergency' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByLabelText('Landmark')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByLabelText('Issue')).toBeDefined())
    expect((screen.getByLabelText('Issue') as HTMLSelectElement).value).toBe('fallen_wires')
    expect((screen.getByLabelText('Severity') as HTMLSelectElement).value).toBe('emergency')
  })

  it('back button on the first step is a non-submitting button', () => {
    renderPage()
    const backButton = screen.getByRole('button', { name: /back to previous page/i })
    expect(backButton).toBeDefined()
    expect(backButton.getAttribute('type')).toBe('button')
  })
})
