import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ClipboardList, Grid2X2, RadioTower, ShieldCheck, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, formatDate, humanize } from '../api'
import { LoadTemperatureChart } from '../components/Charts'
import { NetworkMapView } from '../components/NetworkMap'
import { Badge, Button, Card, CardHeader, ErrorState, Skeleton } from '../components/ui'
import type { AlertRecord, Complaint, NetworkMap, Overview, Transformer } from '../types'

interface TrendResponse { series: Array<{ timestamp: string; load_utilization: { value: number }; oil_temperature: { value: number } }> }

function Kpi({ icon: Icon, value, label, detail, tone }: { icon: typeof Zap; value: number | string; label: string; detail: string; tone: string }) {
  return <Card className="flex min-h-24 items-center gap-4 p-4"><div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-6 w-6" /></div><div><p className="text-2xl font-bold tracking-tight">{value}</p><p className="text-xs font-semibold text-slate-700">{label}</p><p className="mt-0.5 text-[10px] text-slate-500">{detail}</p></div></Card>
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/api/dashboard/overview'), refetchInterval: 15000 })
  const map = useQuery({ queryKey: ['map'], queryFn: () => api<NetworkMap>('/api/network/map'), refetchInterval: 20000 })
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api<AlertRecord[]>('/api/dashboard/recent-alerts?limit=6'), refetchInterval: 15000 })
  const complaints = useQuery({ queryKey: ['complaints'], queryFn: () => api<Complaint[]>('/api/complaints'), refetchInterval: 12000 })
  const trends = useQuery({ queryKey: ['trends', 24], queryFn: () => api<TrendResponse>('/api/dashboard/load-temperature-trends?hours=24') })
  const selectedAsset = useQuery({ queryKey: ['transformer', selected], queryFn: () => api<Transformer>(`/api/transformers/${selected}?readings_limit=24`), enabled: Boolean(selected) })

  if (overview.isError) return <div className="p-6"><ErrorState error={overview.error} /></div>
  return <div className="space-y-4 p-4 lg:p-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Control room</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Grid intelligence dashboard</h1><p className="text-sm text-slate-500">Synthetic network · model-assisted decision support · no switching controls</p></div><Badge tone="green">● Live-style data (simulated)</Badge></div>
    {!overview.data ? <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Skeleton className="h-24"/><Skeleton className="h-24"/><Skeleton className="h-24"/><Skeleton className="h-24"/></div> : <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi icon={Grid2X2} value={overview.data.total_transformers} label="Total Transformers" detail={`Across ${overview.data.total_feeders} feeders`} tone="bg-emerald-100 text-emerald-700" />
      <Kpi icon={AlertTriangle} value={overview.data.risk_counts.high_risk} label="At Risk" detail={`${overview.data.risk_counts.warning} additional warnings`} tone="bg-red-100 text-red-600" />
      <Kpi icon={Zap} value={overview.data.active_incidents} label="Active Outages" detail={`${overview.data.estimated_affected_households} households estimated`} tone="bg-orange-100 text-orange-600" />
      <Kpi icon={ClipboardList} value={complaints.data?.filter(item => item.work_order_status !== 'closed').length ?? 0} label="Pending Complaints" detail="Persistent backend records" tone="bg-blue-100 text-blue-600" />
    </div>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,.75fr)]">
      <Card><CardHeader title="Virtual Transformer Network" subtitle="24 unique synthetic assets and explicit feeder relationships" action={<Button variant="ghost" onClick={() => navigate('/map')}>Open full map</Button>} /><div className="p-3">{map.data ? <NetworkMapView data={map.data} height={450} onSelect={setSelected} /> : <Skeleton className="h-[450px]" />}</div></Card>
      <div className="space-y-4">
        <Card><CardHeader title="Recent Alerts" action={<button className="text-xs font-semibold text-blue-600" onClick={() => navigate('/alerts')}>View all</button>} /><div className="divide-y divide-slate-100">{alerts.data?.map(alert => <button key={alert.id} onClick={() => alert.transformer_id && navigate(`/transformers/${alert.transformer_id}`)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-slate-50"><div className={`mt-0.5 grid h-9 w-9 place-items-center rounded-lg ${alert.severity === 'critical' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}><AlertTriangle className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-xs font-bold">{alert.transformer_id ?? alert.feeder_id}</p><Badge tone={alert.severity === 'critical' ? 'red' : 'amber'}>{alert.severity}</Badge></div><p className="mt-1 text-xs text-slate-600">{alert.explanation}</p><p className="mt-1 text-[10px] text-slate-400">{formatDate(alert.created_at)}</p></div></button>)}</div></Card>
        <Card><CardHeader title="Active Complaints" action={<button className="text-xs font-semibold text-blue-600" onClick={() => navigate('/complaints')}>View all</button>} /><div className="divide-y divide-slate-100">{complaints.data?.slice(0, 5).map(item => <button key={item.id} onClick={() => navigate(`/track/${item.reference}`)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50"><RadioTower className="h-4 w-4 text-blue-600" /><div className="min-w-0 flex-1"><p className="text-xs font-bold">#{item.reference} · {item.village_name}</p><p className="truncate text-xs text-slate-500">{humanize(item.category)}</p></div><Badge tone={item.severity === 'emergency' || item.severity === 'high' ? 'red' : 'amber'}>{item.severity}</Badge></button>)}</div></Card>
      </div>
    </div>
    <Card><CardHeader title="Load vs Temperature" subtitle="Hourly fleet averages · persisted synthetic history" />{trends.data ? <div className="p-3"><LoadTemperatureChart data={trends.data.series} /></div> : <Skeleton className="m-4 h-52" />}</Card>
    <AnimatePresence>{selected && <motion.div initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: 'spring', damping: 28, stiffness: 260 }} className="fixed bottom-0 right-0 top-16 z-[900] w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl"><button className="float-right text-slate-400" onClick={() => setSelected(null)}>✕</button>{selectedAsset.data ? <div className="space-y-5"><div><Badge tone={selectedAsset.data.latest_prediction.risk_level === 'high' ? 'red' : selectedAsset.data.latest_prediction.risk_level === 'warning' ? 'amber' : 'green'}>{selectedAsset.data.latest_prediction.risk_level} risk</Badge><h2 className="mt-3 text-2xl font-bold">{selectedAsset.data.id}</h2><p className="text-sm text-slate-500">{selectedAsset.data.village_name} · {selectedAsset.data.feeder_id}</p></div><div className="grid grid-cols-2 gap-3"><Metric label="Load" value={`${selectedAsset.data.readings?.[0]?.load_pct.toFixed(1)}%`} /><Metric label="Oil temperature" value={`${selectedAsset.data.readings?.[0]?.oil_temp_c.toFixed(1)} °C`} /><Metric label="Health" value={`${selectedAsset.data.health?.overall_health_index.toFixed(0)}/100`} /><Metric label="24h risk" value={`${(selectedAsset.data.latest_prediction.risk_score * 100).toFixed(0)}%`} /></div><div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800"><ShieldCheck className="mb-2 h-5 w-5" />Health and short-term model risk are separate analytical products.</div><Button className="w-full" onClick={() => navigate(`/transformers/${selected}`)}>View Full Analysis</Button><Button variant="secondary" className="w-full" onClick={() => navigate(`/simulation?transformer=${selected}`)}>Open Simulation Lab</Button></div> : <Skeleton className="h-96" />}</motion.div>}</AnimatePresence>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div> }
