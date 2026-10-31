import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditLogsPage } from './AuditLogs'

const response = {
  items: [
    {
      id: 1,
      event_id: 'EVT-REAL-000001',
      timestamp: '2026-10-31T08:00:00Z',
      actor: 'Administrator',
      actor_role: 'administrator',
      action: 'auth.login',
      module: 'Authentication',
      resource: 'user:admin',
      result: 'SUCCESS',
      origin: 'REAL',
      details: { summary: 'Administrator signed in.' },
    },
    {
      id: 2,
      event_id: 'EVT-SIM-003',
      timestamp: '2026-10-31T08:05:00Z',
      actor: 'Control Room Operator',
      actor_role: 'operator',
      action: 'risk_assessment.reviewed',
      module: 'Risk Assessment',
      resource: 'transformer:T-101',
      result: 'SUCCESS',
      origin: 'SIMULATED',
      details: { summary: 'Synthetic uncalibrated demonstration output reviewed.' },
    },
  ],
  total: 30,
  page: 1,
  page_size: 25,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AuditLogsPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AuditLogsPage', () => {
  it('renders normalized fields with explicit REAL and SIMULATED provenance', async () => {
    renderPage()

    await waitFor(() => expect(screen.getAllByText('EVT-SIM-003').length).toBeGreaterThan(0))
    expect(screen.getAllByText('EVT-REAL-000001').length).toBeGreaterThan(0)
    expect(screen.getAllByText('REAL').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SIMULATED').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Risk Assessment').length).toBeGreaterThan(0)
    expect(screen.getAllByText('transformer:T-101').length).toBeGreaterThan(0)
    expect(screen.getByText('Synthetic events must always be distinguishable from genuine security and operational audit records.')).toBeDefined()
  })

  it('requests search, provenance, role, module, and date filters', async () => {
    renderPage()
    await waitFor(() => expect(vi.mocked(window.fetch)).toHaveBeenCalled())

    fireEvent.change(screen.getByPlaceholderText('Search event, actor, action, resource'), { target: { value: 'risk' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by origin' }), { target: { value: 'SIMULATED' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by role' }), { target: { value: 'operator' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by module' }), { target: { value: 'Risk Assessment' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })

    await waitFor(() => {
      const urls = vi.mocked(window.fetch).mock.calls.map(call => String(call[0]))
      expect(urls.some(url => url.includes('search=risk')
        && url.includes('origin=SIMULATED')
        && url.includes('role=operator')
        && url.includes('module=Risk+Assessment')
        && url.includes('date_from=2026-10-01T00%3A00%3A00Z')
        && url.includes('date_to=2026-10-31T23%3A59%3A59Z'))).toBe(true)
    })
  })

  it('moves through server-side pages', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      const urls = vi.mocked(window.fetch).mock.calls.map(call => String(call[0]))
      expect(urls.some(url => url.includes('page=2'))).toBe(true)
    })
  })
})
