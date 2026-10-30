import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LoginPage } from './Login'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../auth'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function renderLogin() {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
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

describe('LoginPage', () => {
  it('renders the sign-in form with demo accounts', () => {
    renderLogin()
    expect(screen.getByText('Secure access')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /username/i })).toBeTruthy()
    expect(screen.getByTestId('password-input')).toBeTruthy()
    expect(screen.getByText('operator')).toBeTruthy()
    expect(screen.getByText('lineman1')).toBeTruthy()
  })

  it('calls the login API with the submitted credentials', async () => {
    const fetchMock = vi.mocked(window.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'tok-123',
          token_type: 'Bearer',
          expires_in_seconds: 3600,
          user: {
            id: 2,
            username: 'operator',
            display_name: 'Control Room Operator',
            role: 'operator',
            language: 'en',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    renderLogin()
    fireEvent.change(screen.getByRole('textbox', { name: /username/i }), {
      target: { value: 'operator' },
    })
    fireEvent.change(screen.getByTestId('password-input'), {
      target: { value: 'Operator@123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'operator', password: 'Operator@123' }),
      }),
    )
  })

  it('shows an error when login fails', async () => {
    const fetchMock = vi.mocked(window.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Invalid credentials' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await vi.waitFor(() => expect(screen.getByText('Invalid credentials')).toBeTruthy())
  })
})
