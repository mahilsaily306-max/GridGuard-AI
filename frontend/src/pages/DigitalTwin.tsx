import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Map, LayoutDashboard, Activity, Zap, Thermometer, ShieldCheck, AlertTriangle, Wrench, Clock,
  RefreshCw, ChevronLeft, Play, Pause, SentryGun, HardHat,
} from 'lucide-react'
import { api, formatDate, humanize } from '../api'
import { NetworkMapView } from '../components/NetworkMap'
import { Badge, Button, Card, CardHeader, ErrorState, Select, Skeleton } from '../components/ui'
import type { NetworkMap, Transformer, Complaint } from '../types'

const FEEDER_COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#6366f1'] as const
const MODES: { key: 'geographic' | 'topology' | 'twin'; label: string; icon: React.ElementType }[] = [
  { key: 'geographic', label: 'Geographic', icon: Map },
  { key: 'topology', label: 'Topology', icon: LayoutDashboard },
  { key: 'twin', label: 'Digital Twin', icon: Activity },
]

function riskTone(risk: string) {
  return risk === 'high' ? 'red' : risk === 'warning' ? 'amber' : 'green'
}

function groupBy<T>(list: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>()
  for (const item of list) {
    const k = key(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return map
}

function computeSchematic(
  features: { properties: Record<string, unknown> }[],
  width: number,
  height: number
) {
  const cx = width / 2
  const cy = height / 2
  const byFeeder = groupBy(features, f => String(f.properties.feeder_id))
  const positions = new Map<string, { x: number; y: number; feeder: string }>()
  const lines: { points: [number, number][]; color: string; dashed?: boolean; feeder: string }[] = []
  const feederIds = Array.from(byFeeder.keys()).sort()
  const angleStep = (2 * Math.PI) / Math.max(feederIds.length, 1)
  feederIds.forEach((fid, i) => {
    const angle = -Math.PI / 2 + i * angleStep
    const ts = byFeeder.get(fid)!.slice().sort((a, b) =>
      String(a.properties.transformer_id).localeCompare(String(b.properties.transformer_id))
    )
    const pts: [number, number][] = []
    ts.forEach((f, j) => {
      const r = 78 + j * 56
      const x = cx + r * Math.cos(angle)
      const y = cy + r * Math.sin(angle)
      positions.set(String(f.properties.transformer_id), { x, y, feeder: fid })
      pts.push([x, y])
    })
    if (pts.length >= 2) lines.push({ points: pts, color: FEEDER_COLORS[i % FEEDER_COLORS.length], feeder: fid })
    if (pts.length) lines.push({ points: [[cx, cy], pts[0]], color: FEEDER_COLORS[i % FEEDER_COLORS.length], dashed: true, feeder: fid })
  })
  return { positions, lines, cx, cy }
}

export function DigitalTwinPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'geographic' | 'topology' | 'twin'>('geographic')
  const [feeder, setFeeder] = useState('')
  const [risk, setRisk] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playback, setPlayback] = useState(false)
  const [viewWidth, setViewWidth] = useState(700)
  const [viewHeight, setViewHeight] = useState(520)

  const query = new URLSearchParams({ ...(feeder ? { feeder_id: feeder } : {}), ...(risk ? { risk_level: risk } : {}) })
  const map = useQuery({
    queryKey: ['map', feeder, risk],
    queryFn: () => api<NetworkMap>(`/api/network/map?${query}`),
  })
  const complaints = useQuery<Complaint[]>({
    queryKey: ['complaints'],
    queryFn: () => api<Complaint[]>('/api/complaints'),
    select: (data) => (data ?? []).filter(c => Boolean(c.transformer_id)),
  })
  const asset = selectedId
    ? useQuery({
        queryKey: ['transformer', selectedId],
        queryFn: () => api<Transformer>(`/api/transformers/${selectedId}?readings_limit=24`),
        enabled: Boolean(selectedId),
      })
    : null

  const features = map.data?.transformers.features ?? []
  const filtered = features.filter(f => {
    if (feeder && String(f.properties.feeder_id) !== feeder) return false
    if (risk && String(f.properties.risk_category) !== risk) return false
    return true
  })
  const schematic = useMemo(() => computeSchematic(filtered, viewWidth, viewHeight), [filtered, viewWidth, viewHeight])

  const selectedAsset = filtered.find(f => String(f.properties.transformer_id) === selectedId)
  const selectedTransformer = asset?.data ?? null
  const latestReading = selectedTransformer?.readings?.[0] ?? selectedTransformer?.latest_reading
  const health = selectedTransformer?.health

  const handleSelect = (id: string) => setSelectedId(id === selectedId ? null : id)

  const complaintsForAsset = useMemo(() =>
    (complaints.data ?? []).filter(c => c.transformer_id === selectedId), [complaints.data, selectedId])

  const panelWidth = 340

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ minHeight: '100vh' }}>
      <div className="border-b border-white/60 bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="p-4 lg:p-6">
          <div className="flex items-center gap-3 mb-3">
            <Activity className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold tracking-tight">Digital Twin</h1>
            <span className="ml-auto px-2 py-0.5 rounded border border-slate-200 text-[10px] font-semibold text-slate-500 uppercase">Synthetic demonstration</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">Three synchronized views of the fictional distribution network. Animations represent schematic activity, not measured power flow.</p>
          <div className="flex items-center gap-2">
            {MODES.map(m => (
              <button key={m.key} onClick={() => setMode(m.key)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${mode === m.key ? 'border-blue-600 bg-blue-600/10 text-blue-700 shadow-sm' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}>
                <m.icon className="h-4 w-4" /> {m.label}
              </button>
            ))}
            <button onClick={() => map.refetch()} className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Select value={feeder} onChange={e => setFeeder(e.target.value)} className="w-32">
              <option value="">All feeders</option>
              {Array.from({ length: 6 }, (_, i) => <option key={i} value={`F-${String(i + 1).padStart(2, '0')}`}>Feeder {i + 1}</option>)}
            </Select>
            <Select value={risk} onChange={e => setRisk(e.target.value)} className="w-32">
              <option value="">All risk levels</option>
              <option value="low">Healthy</option>
              <option value="warning">Warning</option>
              <option value="high">High risk</option>
            </Select>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={playback} onChange={() => setPlayback(!playback)} className="accent-blue-600" />
              <span>{playback ? 'Pause playback' : 'Playback'}</span>
            </label>
          </div>
        </div>
      </div>

      <div className="relative">
        {mode === 'geographic' && (
          <div className="h-[60vh] lg:h-[70vh]">
            {map.isError ? <ErrorState error={map.error} /> : (
              <NetworkMapView data={map.data ?? { transformers: { type: 'FeatureCollection', features: [] }, feeder_areas: { type: 'FeatureCollection', features: [] }, geometry_note: '', data_source: 'synthetic' }} height="100%" onSelect={handleSelect} />
            )}
          </div>
        )}
        {mode === 'topology' && (
          <TopologyView features={filtered} width={viewWidth} height={viewHeight} onSelect={handleSelect} selectedId={selectedId} schematic={schematic} playback={playback} />
        )}
        {mode === 'twin' && (
          <TwinView features={filtered} width={viewWidth} height={viewHeight} onSelect={handleSelect} selectedId={selectedId} schematic={schematic} playback={playback} />
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[60] flex items-center gap-1 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 text-[10px] font-medium text-slate-600 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-slate-400" />{filtered.length} transformers visible
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {selectedAsset && selectedTransformer && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="absolute top-0 right-0 z-[40] h-full w-full lg:w-[360px] border-l border-slate-200 bg-white shadow-2xl flex flex-col"
            style={{ width: panelWidth }}
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <button onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
              <div className="flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Asset inspection</p>
                <h2 className="text-lg font-bold">{selectedTransformer.id}</h2>
                <p className="text-xs text-slate-500">{selectedTransformer.village_name} · {selectedTransformer.feeder_id} · {selectedTransformer.capacity_kva} kVA</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {latestReading ? (
                <Card><CardHeader title="Live readings" subtitle={formatDate(latestReading.observed_at)} />
                  <div className="grid grid-cols-2 gap-3 p-3">
                    <Metric icon={Thermometer} label="Oil temp" value={`${latestReading.oil_temp_c.toFixed(1)} °C`} tone="red" />
                    <Metric icon={Zap} label="Load" value={`${latestReading.load_pct.toFixed(1)}%`} tone="blue" />
                    <Metric icon={Thermometer} label="Ambient" value={`${latestReading.ambient_temp_c.toFixed(1)} °C`} tone="amber" />
                    <Metric icon={ShieldCheck} label="Health" value={`${health?.overall_health_index.toFixed(0) ?? '—'}/100`} tone="green" />
                  </div></Card>
              ) : null}
              {selectedTransformer.latest_prediction ? (
                <Card><CardHeader title="24h fault risk" subtitle="Uncalibrated synthetic model score" />
                  <div className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center ${riskTone(selectedTransformer.latest_prediction.risk_level) === 'red' ? 'bg-red-100' : riskTone(selectedTransformer.latest_prediction.risk_level) === 'amber' ? 'bg-amber-100' : 'bg-emerald-100'} text-${riskTone(selectedTransformer.latest_prediction.risk_level) === 'red' ? 'red-600' : riskTone(selectedTransformer.latest_prediction.risk_level) === 'amber' ? 'amber-600' : 'emerald-600'}`}>
                        {(selectedTransformer.latest_prediction.risk_score * 100).toFixed(0)}%
                      </div>
                      <span className="text-sm font-semibold">{humanize(selectedTransformer.latest_prediction.risk_level)} risk</span>
                    </div>
                    {selectedTransformer.latest_prediction.top_factors?.length ? (
                      <div className="text-xs text-slate-600 space-y-1">
                        <p className="font-semibold mb-1">Contributing factors</p>
                        {selectedTransformer.latest_prediction.top_factors.map(f => <div key={f} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /><span>{humanize(f)}</span></div>)}
                      </div>
                    ) : null}
                  </div></Card>
              ) : null}
              {health ? (
                <Card><CardHeader title="Health index" subtitle={health.health_scoring_version} />
                  <div className="p-3 space-y-3">
                    <div className="h-2 w-full rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" style={{ width: `${Math.max(0, Math.min(100, health.overall_health_index))}%` }} /></div>
                    <p className="text-xs font-semibold">{health.condition}</p>
                    {health.missing_data_flags.length > 0 && (
                      <div className="rounded-lg bg-amber-50 p-2 text-[10px] text-amber-800">Missing evidence: {health.missing_data_flags.join(', ')}</div>
                    )}
                  </div></Card>
              ) : null}
              <Card><CardHeader title="Recent complaints" />
                <div className="p-3 space-y-3">
                  {complaintsForAsset.length === 0 ? <p className="text-xs text-slate-500">No recent complaints</p> :
                    complaintsForAsset.slice(0, 5).map(c => (
                      <div key={c.id} className="flex gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
                        <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-600"><AlertTriangle className="h-4 w-4" /></div>
                        <div className="flex-1"><p className="text-xs font-bold">#{c.reference}</p><p className="text-[10px] text-slate-500">{c.village_name} · {humanize(c.category)}</p><p className="text-[10px] text-slate-400">{c.status}</p></div>
                      </div>
                    ))}
                </div></Card>
              <div className="flex items-center gap-2 pt-2">
                <Button className="w-1/2" onClick={() => navigate(`/transformers/${selectedTransformer.id}`)}>Full details</Button>
                <Button variant="secondary" className="w-1/2" onClick={() => navigate(`/simulation?transformer=${selectedTransformer.id}`)}>Simulate</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Metric({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = { red: 'bg-red-50 text-red-600', blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600' }
  return (
    <div className="rounded-xl border border-slate-200 p-2">
      <div className={`mb-2 grid h-7 w-7 place-items-center rounded ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></div>
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold">{value}</p>
    </div>
  )
}

function TopologyView({ features, width, height, onSelect, selectedId, schematic, playback }: {
  features: { properties: Record<string, unknown> }[]
  width: number; height: number; onSelect: (id: string) => void; selectedId: string | null;
  schematic: { positions: Map<string, { x: number; y: number; feeder: string }>; lines: { points: [number, number][]; color: string; dashed?: boolean; feeder: string }[]; cx: number; cy: number }
  playback: boolean
}) {
  return (
    <div className="relative w-full h-full bg-white/60 rounded-xl border border-slate-200 overflow-hidden">
      <svg width={width} height={height} className="w-full h-full block" style={{ display: 'block' }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
          </marker>
        </defs>
        {schematic.lines.map((line, i) => (
          <polyline key={`line-${i}-${line.feeder}`} points={line.points.map(p => p.join(',')).join(' ')} fill="none" stroke={line.color} strokeWidth={2} strokeOpacity={0.55} strokeDasharray={line.dashed ? '4,3' : '0'} />
        ))}
        <circle cx={schematic.cx} cy={schematic.cy} r={10} fill="#1e293b" stroke="white" strokeWidth={2} />
        <text x={schematic.cx} y={schematic.cy + 4} fontSize="9" fill="#475569" textAnchor="middle" fontWeight="bold">Sub</text>
        {features.map(f => {
          const id = String(f.properties.transformer_id)
          const pos = schematic.positions.get(id)
          if (!pos) return null
          const risk = String(f.properties.risk_category ?? 'low')
          const outage = Boolean(f.properties.outage_status)
          const active = id === selectedId
          const isOutageColor = outage ? '#dc2626' : (risk === 'high' ? '#ef4444' : risk === 'warning' ? '#f59e0b' : '#16a34a')
          return (
            <g key={id} cursor="pointer" onClick={() => onSelect(id)}>
              <circle cx={pos.x} cy={pos.y} r={7} fill="white" stroke={isOutageColor} strokeWidth={active ? 3 : 2} className="transition" />
              <circle cx={pos.x} cy={pos.y} r={4} fill={isOutageColor} />
              {playback && (
                <motion.circle cx={pos.x} cy={pos.y} r={7} fill="none" stroke={isOutageColor} strokeWidth={2} strokeOpacity={0.35}
                  animate={{ r: [7, 14], opacity: [0.5, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
              )}
              <title>{id} · {String(f.properties.village)} · {risk} risk{outage ? ' · OUTAGE' : ''}</title>
            </g>
          )
        })}
      </svg>
      <div className="absolute bottom-2 left-2 z-[10] flex gap-2 text-[10px]">
        <span className="px-2 py-0.5 rounded border border-slate-200 bg-white/90">Feeder lines (simulated topology)</span>
        <span className="px-2 py-0.5 rounded border border-slate-200 bg-white/90">Substation</span>
        <span className={`px-2 py-0.5 rounded border border-slate-200 bg-white/90 ${playback ? 'animate-pulse' : ''}`}>Playback {playback ? 'on' : 'off'}</span>
      </div>
    </div>
  )
}

function TwinView({ features, width, height, onSelect, selectedId, schematic, playback }: {
  features: { properties: Record<string, unknown> }[]
  width: number; height: number; onSelect: (id: string) => void; selectedId: string | null;
  schematic: { positions: Map<string, { x: number; y: number; feeder: string }>; lines: { points: [number, number][]; color: string; dashed?: boolean; feeder: string }[]; cx: number; cy: number }
  playback: boolean
}) {
  const pulse = useMemo(() => ({
    low: { duration: 4, repeat: Infinity },
    warning: { duration: 2.2, repeat: Infinity },
    high: { duration: 1.2, repeat: Infinity },
  }), [])
  return (
    <div className="relative w-full h-full bg-slate-900/60 rounded-xl border border-slate-700 overflow-hidden flex items-center justify-center">
      <svg width={width} height={height} className="w-full h-full block" style={{ display: 'block' }}>
        {schematic.lines.map((line, i) => (
          <polyline key={`tl-${i}-${line.feeder}`} points={line.points.map(p => p.join(',')).join(' ')} fill="none" stroke="#475569" strokeWidth={2} strokeDasharray="6,4" />
        ))}
        <circle cx={schematic.cx} cy={schematic.cy} r={9} fill="#334155" stroke="#94a3b8" strokeWidth={2} />
        <text x={schematic.cx} y={schematic.cy + 3} fontSize="9" fill="#94a3b8" textAnchor="middle" fontWeight="bold">Sub</text>
        {features.map(f => {
          const id = String(f.properties.transformer_id)
          const pos = schematic.positions.get(id)
          if (!pos) return null
          const utilization = Number(f.properties.current_utilization_pct ?? 0)
          const healthIndex = Number(f.properties.health_index ?? 0)
          const riskScore = Number(f.properties.fault_risk_score ?? 0)
          const risk = String(f.properties.risk_category ?? 'low')
          const outage = Boolean(f.properties.outage_status)
          const active = id === selectedId
          const loadPulse = Math.min(2, Math.max(0.6, utilization / 40))
          const isOutageColor = outage ? '#dc2626' : (risk === 'high' ? '#ef4444' : risk === 'warning' ? '#f59e0b' : '#22c55e')
          return (
            <g key={id} cursor="pointer" onClick={() => onSelect(id)}>
              {/* animated load ring */}
              <motion.circle cx={pos.x} cy={pos.y} r={9} fill="none" stroke={isOutageColor} strokeWidth={3}
                animate={{ scale: [1, 1 + 0.15 * loadPulse], opacity: [0.9, 0.5] }}
                transition={{ duration: pulse[risk === 'high' ? 'high' : risk === 'warning' ? 'warning' : 'low'].duration, repeat: Infinity, ease: 'easeInOut' }}
                strokeOpacity={0.6} />
              <circle cx={pos.x} cy={pos.y} r={5.5} fill="#0f172a" stroke={isOutageColor} strokeWidth={active ? 3 : 2} />
              <circle cx={pos.x} cy={pos.y} r={2.5} fill={isOutageColor} />
              {/* health index wedge */}
              <path d={healthArc(pos.x, pos.y, 7, healthIndex / 100)} fill="none" stroke={healthIndex >= 60 ? '#16a34a' : healthIndex >= 35 ? '#f59e0b' : '#ef4444'} strokeWidth={2.5} strokeOpacity={0.9} />
              {outage && <text x={pos.x} y={pos.y - 11} fontSize="9" fill="#dc2626" textAnchor="middle" fontWeight="bold">!</text>}
              <title>{id} · {String(f.properties.village)} · load {utilization.toFixed(0)}% · health {healthIndex.toFixed(0)} · risk {(riskScore * 100).toFixed(0)}%{outage ? ' · OUTAGE' : ''}</title>
            </g>
          )
        })}
      </svg>
      <div className="absolute bottom-2 left-2 z-[10] flex gap-2 text-[10px]">
        <span className="px-2 py-0.5 rounded border border-slate-700 bg-white/10">Load ring (animated)</span>
        <span className="px-2 py-0.5 rounded border border-slate-700 bg-white/10">Health wedge</span>
        <span className={`px-2 py-0.5 rounded border border-slate-700 bg-white/10 ${playback ? 'animate-pulse' : ''}`}>Twin {playback ? 'live' : 'paused'}</span>
      </div>
      <div className="absolute bottom-2 right-2 z-[10] text-[10px] text-slate-400">Schematic activity — not measured power flow</div>
    </div>
  )
}

function healthArc(cx: number, cy: number, r: number, pct: number) {
  const start = -Math.PI / 2
  const end = start + 2 * Math.PI * Math.max(0, Math.min(1, pct))
  const x1 = cx + r * Math.cos(start)
  const y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const largeArc = end - start > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}
