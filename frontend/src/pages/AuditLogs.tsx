import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileClock, Search, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api, formatDate, humanize } from '../api'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, Select, Skeleton } from '../components/ui'

type AuditEvent = {
  id: number
  event_id: string
  timestamp: string
  actor: string
  actor_role: string
  action: string
  module: string
  resource: string
  result: string
  origin: 'REAL' | 'SIMULATED'
  details: Record<string, unknown>
}

type AuditResponse = {
  items: AuditEvent[]
  total: number
  page: number
  page_size: number
}

const roles = ['administrator', 'operator', 'lineman', 'supervisor', 'public']
const modules = ['Authentication', 'Dashboard', 'Risk Assessment', 'Alerts', 'Complaints', 'Incidents', 'Dispatch', 'Work Orders', 'Inspection', 'Diagnosis', 'Evidence', 'Approval', 'Closure', 'Reporting', 'Simulation', 'Knowledge Base']

export function AuditLogsPage() {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [module, setModule] = useState('')
  const [origin, setOrigin] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (search.trim()) params.set('search', search.trim())
  if (role) params.set('role', role)
  if (module) params.set('module', module)
  if (origin) params.set('origin', origin)
  if (dateFrom) params.set('date_from', `${dateFrom}T00:00:00Z`)
  if (dateTo) params.set('date_to', `${dateTo}T23:59:59Z`)

  const query = useQuery({
    queryKey: ['audit', search, role, module, origin, dateFrom, dateTo, page],
    queryFn: () => api<AuditResponse>(`/api/audit-logs?${params}`),
  })
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / pageSize))
  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  return <div className="space-y-4 p-4 lg:p-6">
    <div>
      <p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Accountability</p>
      <h1 className="text-2xl font-bold">Audit Logs</h1>
      <p className="text-sm text-slate-500">Append-only records of authentication, access, and workflow decisions.</p>
    </div>

    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <ShieldCheck className="mr-2 inline h-5 w-5" />
      Synthetic events must always be distinguishable from genuine security and operational audit records.
    </div>

    <Card>
      <CardHeader title="Audit filters" subtitle="Search identifiers and details, or narrow by provenance and workflow context" />
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <label className="sm:col-span-2"><span className="sr-only">Search audit logs</span><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Search event, actor, action, resource" value={search} onChange={event => updateFilter(setSearch, event.target.value)} /></div></label>
        <label><span className="sr-only">Filter by origin</span><Select value={origin} onChange={event => updateFilter(setOrigin, event.target.value)}><option value="">All origins</option><option value="REAL">REAL</option><option value="SIMULATED">SIMULATED</option></Select></label>
        <label><span className="sr-only">Filter by role</span><Select value={role} onChange={event => updateFilter(setRole, event.target.value)}><option value="">All roles</option>{roles.map(item => <option key={item}>{item}</option>)}</Select></label>
        <label><span className="sr-only">Filter by module</span><Select value={module} onChange={event => updateFilter(setModule, event.target.value)}><option value="">All modules</option>{modules.map(item => <option key={item}>{item}</option>)}</Select></label>
        <div className="grid grid-cols-2 gap-2"><label><span className="text-[10px] font-semibold text-slate-500">From</span><Input type="date" value={dateFrom} onChange={event => updateFilter(setDateFrom, event.target.value)} /></label><label><span className="text-[10px] font-semibold text-slate-500">To</span><Input type="date" value={dateTo} onChange={event => updateFilter(setDateTo, event.target.value)} /></label></div>
      </div>
    </Card>

    <Card>
      <CardHeader title="Audit events" subtitle={query.data ? `${query.data.total.toLocaleString()} matching records · newest first` : 'Newest events first'} />
      {query.isError ? <div className="p-4"><ErrorState error={query.error} /></div> : !query.data ? <div className="p-4"><Skeleton className="h-72" /></div> : query.data.items.length === 0 ? <EmptyState title="No audit events" detail="Adjust the filters or create a workflow event." /> : <>
        <div className="grid gap-3 p-4 lg:hidden">{query.data.items.map(item => <AuditCard key={item.event_id} item={item} />)}</div>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1100px] text-left text-sm"><caption className="sr-only">Audit event records</caption><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">Timestamp</th><th>Event ID</th><th>Actor</th><th>Action</th><th>Module</th><th>Resource</th><th>Result</th><th>Origin</th><th>Detail</th></tr></thead><tbody className="divide-y divide-slate-100">{query.data.items.map(item => <tr key={item.event_id} className="align-top"><td className="whitespace-nowrap p-4 text-xs text-slate-500">{formatDate(item.timestamp)}</td><td className="whitespace-nowrap font-mono text-xs">{item.event_id}</td><td><p className="font-semibold">{item.actor}</p><p className="text-xs text-slate-500">{humanize(item.actor_role)}</p></td><td className="font-semibold">{humanize(item.action.replaceAll('.', '_'))}</td><td>{item.module}</td><td className="font-mono text-xs">{item.resource}</td><td><Badge tone={item.result === 'SUCCESS' ? 'green' : 'red'}>{item.result}</Badge></td><td><OriginBadge origin={item.origin} /></td><td className="w-48 pr-4"><AuditDetails details={item.details} /></td></tr>)}</tbody></table></div>
      </>}
      {query.data && query.data.total > 0 && <div className="flex items-center justify-between border-t border-slate-100 p-4 text-sm"><p className="text-slate-500">Page {page} of {pages}</p><div className="flex gap-2"><Button variant="secondary" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" />Previous</Button><Button variant="secondary" onClick={() => setPage(value => Math.min(pages, value + 1))} disabled={page >= pages}>Next<ChevronRight className="h-4 w-4" /></Button></div></div>}
    </Card>
  </div>
}

function AuditCard({ item }: { item: AuditEvent }) {
  return <article className="rounded-xl border border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><FileClock className="h-5 w-5" /></div><OriginBadge origin={item.origin} /></div>
    <p className="mt-4 font-mono text-xs font-semibold">{item.event_id}</p>
    <h2 className="mt-1 font-bold">{humanize(item.action.replaceAll('.', '_'))}</h2>
    <dl className="mt-3 grid grid-cols-[90px_1fr] gap-2 text-xs"><dt className="text-slate-500">Timestamp</dt><dd>{formatDate(item.timestamp)}</dd><dt className="text-slate-500">Actor</dt><dd>{item.actor} · {humanize(item.actor_role)}</dd><dt className="text-slate-500">Module</dt><dd>{item.module}</dd><dt className="text-slate-500">Resource</dt><dd className="font-mono">{item.resource}</dd><dt className="text-slate-500">Result</dt><dd>{item.result}</dd></dl>
    <div className="mt-4"><AuditDetails details={item.details} /></div>
  </article>
}

function OriginBadge({ origin }: { origin: AuditEvent['origin'] }) {
  return <Badge tone={origin === 'REAL' ? 'green' : 'violet'}>{origin}</Badge>
}

function AuditDetails({ details }: { details: Record<string, unknown> }) {
  return <details className="text-xs"><summary className="cursor-pointer font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">View details</summary><pre className="mt-2 max-w-xs overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[10px] leading-5 text-slate-100">{JSON.stringify(details, null, 2)}</pre></details>
}
