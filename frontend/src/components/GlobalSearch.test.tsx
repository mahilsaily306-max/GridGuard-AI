import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../auth'
import { GlobalSearch } from './GlobalSearch'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function renderPalette(element: JSX.Element) {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>{element}</AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GlobalSearch command palette', () => {
  it('renders the palette header when open', () => {
    const fetchMock = vi.mocked(window.fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    const { getByText } = renderPalette(<GlobalSearch open={true} onClose={vi.fn()} />)
    expect(getByText('Command palette')).toBeDefined()
  })

  it('renders nothing when closed', () => {
    const { queryByText } = renderPalette(<GlobalSearch open={false} onClose={vi.fn()} />)
    expect(queryByText('Command palette')).toBeNull()
  })
})
