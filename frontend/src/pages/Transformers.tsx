import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, Search, Thermometer, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, humanize } from '../api'
import { Badge, Card, CardHeader, ErrorState, Input, Skeleton } from '../components/ui'
import type { Transformer } from '../types'

export function TransformersPage() {
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['transformers'], queryFn: () => api<Transformer[]>('/api/transformers') })
  const filtered = useMemo(() => query.data?.filter(item => `${item.id} ${item.village_name} ${item.feeder_id}`.toLowerCase().includes(search.toLowerCase())) ?? [], [query.data, search])
  return <div className="space-y-4 p-4 lg:p-6"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Asset registry</p><h1 className="text-2xl font-bold">Transformers</h1><p className="text-sm text-slate-500">24 unique assets with persisted telemetry and model predictions.</p></div><Card><CardHeader title="Transformer fleet" action={<div className="relative w-72 max-w-full"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search ID, village, feeder" className="pl-9" /></div>} />{query.isError ? <div className="p-4"><ErrorState error={query.error}/></div> : !query.data ? <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div> : <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(item => <button key={item.id} onClick={() => navigate(`/transformers/${item.id}`)} className="group rounded-xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg"><div className="flex items-start justify-between"><div><p className="text-lg font-bold">{item.id}</p><p className="text-xs text-slate-500">{item.village_name} · {item.feeder_id}</p></div><Badge tone={item.latest_prediction.risk_level === 'high' ? 'red' : item.latest_prediction.risk_level === 'warning' ? 'amber' : 'green'}>{humanize(item.latest_prediction.risk_level)}</Badge></div><div className="mt-5 grid grid-cols-3 gap-2"><Mini icon={Zap} label="Load" value={`${item.latest_reading.load_pct.toFixed(0)}%`} /><Mini icon={Thermometer} label="Oil" value={`${item.latest_reading.oil_temp_c.toFixed(0)}°`} /><Mini icon={Activity} label="Risk" value={`${(item.latest_prediction.risk_score * 100).toFixed(0)}%`} /></div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{item.capacity_kva} kVA · {item.age_years} years</span><ArrowRight className="h-4 w-4 transition group-hover:translate-x-1 group-hover:text-blue-600" /></div></button>)}</div>}</Card></div>
}

function Mini({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-2"><Icon className="h-3.5 w-3.5 text-blue-600"/><p className="mt-2 text-[9px] uppercase text-slate-400">{label}</p><p className="text-sm font-bold">{value}</p></div> }
