import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth'
import type { ComponentType } from 'react'

// Every page exported by src/pages and consumed by src/App.tsx.
// If any page stops exporting its <XxxPage> component, the import above
// fails at module load and this test file errors out.
import { DashboardPage } from './pages/Dashboard'
import { AlertsPage } from './pages/Alerts'
import { AuditLogsPage } from './pages/AuditLogs'
import { ComplaintsPage } from './pages/Complaints'
import { ComplaintTrackingPage } from './pages/ComplaintTracking'
import { HelplinePage } from './pages/Helpline'
import { KnowledgeBasePage } from './pages/KnowledgeBase'
import { LoginPage } from './pages/Login'
import { ModelEvaluationPage } from './pages/ModelEvaluation'
import { NetworkPage } from './pages/Network'
import { ReplayPage } from './pages/Replay'
import { ReportsPage } from './pages/Reports'
import { SimulationPage } from './pages/Simulation'
import { TransformerDetailPage } from './pages/TransformerDetail'
import { TransformersPage } from './pages/Transformers'
import { UsersPage } from './pages/Users'
import { WorkOrderDetailPage } from './pages/WorkOrderDetail'
import { WorkOrdersPage } from './pages/WorkOrders'

const pages: Array<[string, ComponentType]> = [
  ['Dashboard', DashboardPage],
  ['Alerts', AlertsPage],
  ['AuditLogs', AuditLogsPage],
  ['Complaints', ComplaintsPage],
  ['ComplaintTracking', ComplaintTrackingPage],
  ['Helpline', HelplinePage],
  ['KnowledgeBase', KnowledgeBasePage],
  ['Login', LoginPage],
  ['ModelEvaluation', ModelEvaluationPage],
  ['Network', NetworkPage],
  ['Replay', ReplayPage],
  ['Reports', ReportsPage],
  ['Simulation', SimulationPage],
  ['TransformerDetail', TransformerDetailPage],
  ['Transformers', TransformersPage],
  ['Users', UsersPage],
  ['WorkOrderDetail', WorkOrderDetailPage],
  ['WorkOrders', WorkOrdersPage],
]

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function renderApp(element: JSX.Element) {
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

describe('Application page imports', () => {
  it.each(pages)('exports a %sPage component', (_name, page) => {
    expect(typeof page).toBe('function')
  })

  it('mounts the DashboardPage without import or dependency errors', () => {
    const fetchMock = vi.mocked(window.fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    renderApp(<DashboardPage />)
  })
})
