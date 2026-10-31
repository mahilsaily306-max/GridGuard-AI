import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ComplaintsPage } from './Complaints'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../auth'
import type { Complaint } from '../types'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const complaints: Complaint[] = [
  {
    id: 1,
    reference: 'GG-AAAA1111',
    incident_id: 1,
    village_name: 'Demo Village A',
    transformer_id: 'T-101',
    category: 'power_outage',
    severity: 'high',
    status: 'received',
    incident_status: 'reported',
    work_order_status: null,
    tracking_steps: [{ key: 'received', label: 'Complaint received', complete: true }],
    created_at: '2026-10-30T09:10:53.280341Z',
  },
  {
    id: 2,
    reference: 'GG-BBBB2222',
    incident_id: 2,
    village_name: 'Demo Village B',
    transformer_id: 'T-102',
    category: 'sparking_fire',
    severity: 'emergency',
    status: 'assigned',
    incident_status: 'assigned',
    work_order_status: 'assigned',
    tracking_steps: [
      { key: 'received', label: 'Complaint received', complete: true },
      { key: 'assigned', label: 'Work order assigned', complete: true },
    ],
    created_at: '2026-10-30T10:00:00Z',
  },
]

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/complaints']}>
        <AuthProvider>
          <ComplaintsPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(complaints), { status: 200, headers: { 'content-type': 'application/json' } })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ComplaintsPage', () => {
  it('renders the complaint queue with references and villages', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('GG-AAAA1111')).toBeTruthy())
    expect(screen.getByText('Demo Village A')).toBeTruthy()
    expect(screen.getByText('Demo Village B')).toBeTruthy()
    expect(screen.getByText(/Track Complaint|Complaints/)).toBeTruthy()
  })

  it('links each reference to its public tracking page', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('GG-AAAA1111')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'GG-AAAA1111' })).toHaveAttribute('href', '/track/GG-AAAA1111')
  })

  it('sends a search param for reference or village', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('GG-AAAA1111')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('Search reference or village'), { target: { value: 'Demo Village B' } })
    await waitFor(() => {
      const urls = vi.mocked(window.fetch).mock.calls.map(call => String(call[0]))
      expect(urls.some(url => url.includes('search=Demo+Village+B'))).toBe(true)
    })
  })

  it('sends a status filter param', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('GG-AAAA1111')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'assigned' } })
    await waitFor(() => {
      const urls = vi.mocked(window.fetch).mock.calls.map(call => String(call[0]))
      expect(urls.some(url => url.includes('status=assigned'))).toBe(true)
    })
  })

  it('shows an empty state when no complaints match', async () => {
    vi.mocked(window.fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }))
    renderPage()
    await waitFor(() => expect(screen.getByText('No complaints')).toBeTruthy())
  })

  it('shows an error state when the list fetch fails', async () => {
    vi.mocked(window.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy())
  })
})
