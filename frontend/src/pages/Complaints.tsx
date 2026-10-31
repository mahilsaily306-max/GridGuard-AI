import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, RadioTower, Send, ShieldAlert, Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { api, formatDate, humanize } from '../api'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, Select, Skeleton } from '../components/ui'
import type { Complaint } from '../types'

const statuses = ['received', 'assigned', 'investigating', 'repairing', 'awaiting_verification', 'resolved', 'closed']

export function ComplaintsPage() {
  const navigate = useNavigate(); const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const complaints = useQuery({
    queryKey: ['complaints', search, status],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (status) params.set('status', status)
      return api<Complaint[]>(`/api/complaints?${params}`)
    },
    refetchInterval: 10000,
  })
  const dispatch = useMutation({ mutationFn: (incidentId: number) => api(`/api/incidents/${incidentId}/dispatch`, { method: 'POST', body: JSON.stringify({ priority: 'high' }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['complaints'] }) })
  return <div className="space-y-4 p-4 lg:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Community reports</p><h1 className="text-2xl font-bold">Complaints</h1><p className="text-sm text-slate-500">Reports support localization but do not prove transformer failure.</p></div><div className="flex flex-wrap gap-3 items-end"><div className="relative"><label htmlFor="complaint-search" className="sr-only">Search complaints</label><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input id="complaint-search" className="pl-9 min-w-[220px]" placeholder="Search reference or village" value={search} onChange={event => setSearch(event.target.value)} /></div></div><label htmlFor="complaint-status" className="hidden sm:block text-xs font-semibold text-slate-500">Status</label><Select id="complaint-status" value={status} onChange={event => setStatus(event.target.value)} className="max-w-xs"><option value="">All statuses</option>{statuses.map(item => <option key={item} value={item}>{humanize(item)}</option>)}</Select><Button onClick={() => navigate('/helpline')}><RadioTower className="h-4 w-4" />New complaint</Button></div></div><Card><CardHeader title="Complaint queue" subtitle="Individual records are preserved even when reports group into one incident"/>{complaints.isError ? <div className="p-4"><ErrorState error={complaints.error} /></div> : !complaints.data ? <Skeleton className="m-4 h-96" /> : complaints.data.length === 0 ? <EmptyState title="No complaints" detail="Adjust the search or status filter, or create a simulated report through the Villager Helpline." /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{complaints.data.map(item => <tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-3"><Link className="font-bold text-blue-600" to={`/track/${item.reference}`}>{item.reference}</Link></td><td className="px-4 py-3">{item.village_name}<p className="text-xs text-slate-400">{item.transformer_id ?? 'Area-level report'}</p></td><td className="px-4 py-3">{humanize(item.category)}</td><td className="px-4 py-3"><Badge tone={item.severity === 'emergency' || item.severity === 'high' ? 'red' : 'amber'}>{item.severity}</Badge></td><td className="px-4 py-3"><Badge tone="blue">{humanize(item.work_order_status ?? item.incident_status ?? item.status)}</Badge></td><td className="px-4 py-3 text-xs text-slate-500">{formatDate(item.created_at)}</td><td className="px-4 py-3">{!item.work_order_status ? <Button className="min-h-8 px-3 py-1 text-xs" onClick={() => dispatch.mutate(item.incident_id)} disabled={dispatch.isPending}><Send className="h-3 w-3" />Dispatch</Button> : <Button variant="ghost" className="min-h-8 px-3 py-1 text-xs" onClick={() => navigate('/work-orders')}>View work</Button>}</td></tr>)}</tbody></table></div>}</Card><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><ShieldAlert className="mr-2 inline h-4 w-4" />Hazard reports are escalated for qualified human review. GridGuard provides no electrical switching or repair instructions.</div></div>
}
