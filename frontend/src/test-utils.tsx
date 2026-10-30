import { ReactNode } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity },
  },
})

// Renders a component wrapped in the providers the app needs:
// QueryClientProvider (React Query), BrowserRouter (routing), AuthProvider (auth).
export function renderWithProviders(ui: ReactNode, options?: RenderOptions) {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>{ui}</AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
    options,
  )
  return { ...utils }
}

export { screen } from '@testing-library/react'
