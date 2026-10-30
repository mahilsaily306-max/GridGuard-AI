import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ComplaintTrackingPage } from './ComplaintTracking'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth'
import type { Complaint } from '../types'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const complaint: Complaint = {
  id: 1,
  reference: 'GG-F6C22384',
  incident_id: 2,
  village_name: 'Demo Village A',
  transformer_id: 'T-101',
  category: 'power_outage',
  severity: 'high',
  status: 'received',
  incident_status: 'reported',
  work_order_status: 'assigned',
  tracking_steps: [
    { key: 'received', label: 'Complaint received', complete: true },
    { key: 'dispatched', label: 'Incident dispatched', complete: true },
    { key: 'assigned', label: 'Work order assigned', complete: false },
  ],
  created_at: '2026-10-30T09:10:53.280341Z',
}

function renderTracking(initialEntry: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <Routes>
            <Route path="/track/:reference?" element={<ComplaintTrackingPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ComplaintTrackingPage', () => {
  it('shows the input form when no reference is provided', () => {
    renderTracking('/track')
    expect(screen.getByText('Track Complaint')).toBeTruthy()
    expect(screen.getByPlaceholderText('GG-XXXXXXXX')).toBeTruthy()
    const trackBtn = screen.getByRole('button', { name: /track/i })
    expect((trackBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables the track button after entering a reference', () => {
    renderTracking('/track')
    const input = screen.getByPlaceholderText('GG-XXXXXXXX')
    fireEvent.change(input, { target: { value: 'gg-f6c22384' } })
    expect((screen.getByRole('button', { name: /track/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows tracking steps when a valid reference is fetched', async () => {
    const fetchMock = vi.mocked(window.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(complaint), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    renderTracking('/track/GG-F6C22384')

    await waitFor(() => expect(screen.getByText('GG-F6C22384')).toBeTruthy())
    expect(screen.getByText('Complaint received')).toBeTruthy()
    expect(screen.getByText('Incident dispatched')).toBeTruthy()
    expect(screen.getByText(/Demo Village A/)).toBeTruthy()
  })

  it('shows an error state when the complaint fetch fails', async () => {
    const fetchMock = vi.mocked(window.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    renderTracking('/track/GG-NOSUCH')

    await waitFor(() => expect(screen.getByText('Not found')).toBeTruthy())
  })
})
