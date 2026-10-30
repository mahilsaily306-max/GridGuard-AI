import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Zap, Thermometer, AlertTriangle, ShieldCheck, Clock, Wrench, Filter, SortAscending, SortDescending,
  MapPin, Activity, SlidersHorizontal, Play, Pause, ChevronRight,
} from 'lucide-react'
import { api } from '../api'
import { Badge, Button, Card, CardHeader, ErrorState, Select, Skeleton } from '../components/ui'
import type { Transformer, Complaint, AlertRecord } from '../types'

function riskTone(level: string) {
  return level === 'high' ? 'red' : level === 'warning' ? 'amber' : 'green'
}

function priorityLevel(score: number) {
  if (score >= 0.70) return { level: 'Critical', tone: 'red' as const, color: '#dc2626' }
  if (score >= 0.50) return { level: 'High', tone: 'orange' as const, color: '#ea580c' }
  if (score >= 0.30) return { level: 'Medium', tone: 'blue' as const, color: '#2563eb' }
  return { level: 'Low', tone: 'green' as const, color: '#16a34a' }
}

function dataQuality(transformer: Transformer | null) {
  if (!transformer) return { score: 0, label: 'Unknown', flags: 0 }
  let flags = 0
  if (transformer.telemetry_status?.stale) flags += 1
  if (transformer.health?.missing_data_flags.length) flags += transformer.health.missing_data_flags.length
  const score = Math.max(0, 1 - flags * 0.25)
  let label = 'Good'
  if (score < 0.5) label = 'Poor'
  else if (score < 0.75) label = 'Fair'
  return { score, label, flags }
}

function computePriority(
  transformer: Transformer,
  complaints: Complaint[],
  alerts: AlertRecord[],
): { score: number; factors: string[]; urgency: string } {
  const reading = transformer.latest_reading
  const health = transformer.health
  const prediction = transformer.latest_prediction
  const faults = Array.isArray(transformer.fault_history) ? transformer.fault_history : []
  const assetComplaints = complaints.filter(c => c.transformer_id === transformer.id)
  const openComplaints = assetComplaints.filter(c => c.status !== 'resolved' && c.status !== 'closed')
  const assetAlerts = alerts.filter(a => a.transformer_id === transformer.id)

  const factors: string[] = []

  // ML risk (0-1) weight 0.30
  const riskScore = prediction?.risk_score ?? 0
  const riskContrib = riskScore * 0.30
  if (riskScore > 0.5) factors.push(`ML risk ${(riskScore * 100).toFixed(0)}%`)

  // Health degradation weight 0.25
  const healthIndex = health?.overall_health_index ?? 100
  const healthDegradation = Math.max(0, 100 - healthIndex) / 100
  const healthContrib = healthDegradation * 0.25
  if (healthIndex < 70) factors.push(`Health ${healthIndex.toFixed(0)}/100`)

  // Load utilization weight 0.20
  const loadPct = reading?.load_pct ?? 0
  const loadContrib = (loadPct / 100) * 0.20
  if (loadPct > 75) factors.push(`Load ${loadPct.toFixed(0)}%`)

  // Fault frequency weight 0.15
  const faultScore = Math.min(faults.length / 5, 1)
  const faultContrib = faultScore * 0.15
  if (faults.length > 0) factors.push(`${faults.length} prior fault(s)`)

  // Open complaints weight 0.10
  const complaintScore = Math.min(openComplaints / 3, 1)
  const complaintContrib = complaintScore * 0.10
  if (openComplaints > 0) factors.push(`${openComplaints} open complaint(s)`)

  const score = Math.min(1, riskContrib + healthContrib + loadContrib + faultContrib + complaintContrib)

  let urgency = 'Routine'
  if (score >= 0.70) urgency = 'Immediate'
  else if (score >= 0.50) urgency = 'This week'
  else if (score >= 0.30) urgency = 'This month'

  return { score, factors, urgency }
}

export function RiskPrioritizationPage() {
  const navigate = useNavigate()
  const [sortKey, setSortKey] = useState<'score' | 'transformer' | 'feeder' | 'village' | 'health' | 'risk' | 'priority'>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [feederFilter, setFeederFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [whatIfMode, setWhatIfMode] = useState(false)
  const [whatIfOverrides, setWhatIfOverrides] = useState({
    load_pct: 0,
    oil_temp_c: 0,
    health_index: 0,
  })

  const transformers = useQuery<Transformer[]>({
    queryKey: ['transformers'],
    queryFn: () => api<Transformer[]>('/api/transformers'),
  })
  const complaints = useQuery<Complaint[]>({
    queryKey: ['complaints'],
    queryFn: () => api<Complaint[]>('/api/complaints'),
  })
  const alerts = useQuery<AlertRecord[]>({
    queryKey: ['alerts'],
    queryFn: () => api<AlertRecord[]>('/api/alerts'),
  })

  const loading = transformers.isLoading || complaints.isLoading || alerts.isLoading
  if (loading) return <Skeleton count={8} />

  const txList = transformers.data ?? []
  const complaintList = complaints.data ?? []
  const alertList = alerts.data ?? []

  // Build board entries
  const board = useMemo(() => {
    return txList.map(t => {
      const dq = dataQuality(t)
      const { score, factors, urgency } = computePriority(t, complaintList, alertList)
      const pl = priorityLevel(score)
      const reading = t.latest_reading
      const prediction = t.latest_prediction
      return {
        transformer: t,
        score,
        level: pl.level,
        tone: pl.tone,
        factors,
        urgency,
        dataQuality: dq,
        loadPct: reading?.load_pct ?? 0,
        riskScore: prediction?.risk_score ?? 0,
        riskLevel: prediction?.risk_level ?? 'low',
        healthIndex: t.health?.overall_health_index ?? 100,
      }
    })
  }, [txList, complaintList, alertList])

  // Apply filters
  let filtered = board.filter(b => {
    if (feederFilter && b.transformer.feeder_id !== feederFilter) return false
    if (priorityFilter && b.level !== priorityFilter) return false
    return true
  })

  // Apply sorting
  filtered = [...filtered].sort((a, b) => {
    let av: any, bv: any
    switch (sortKey) {
      case 'score': av = a.score; bv = b.score; break
      case 'transformer': av = a.transformer.id; bv = b.transformer.id; break
      case 'feeder': av = a.transformer.feeder_id; bv = b.transformer.feeder_id; break
      case 'village': av = a.transformer.village_name; bv = b.transformer.village_name; break
      case 'health': av = a.healthIndex; bv = b.healthIndex; break
      case 'risk': av = a.riskScore; bv = b.riskScore; break
      case 'priority':
        const order: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
        av = order[a.level]; bv = order[b.level]; break
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  // What-if simulation (isolated — does not modify any backend record)
  const whatIfBoard = useMemo(() => {
    if (!whatIfMode) return board
    return board.map(b => {
      const t = b.transformer
      const reading = t.latest_reading
      const health = t.health
      const prediction = t.latest_prediction

      // Simulated overrides only for the what-if view
      const simLoad = whatIfOverrides.load_pct || (reading?.load_pct ?? 0)
      const simOilTemp = whatIfOverrides.oil_temp_c || (reading?.oil_temp_c ?? 0)
      const simHealth = whatIfOverrides.health_index || (health?.overall_health_index ?? 100)

      // Recompute priority with simulated values (isolated, no backend write)
      const simRisk = Math.min(1, Math.max(0, prediction?.risk_score ?? 0 +
        (simLoad - (reading?.load_pct ?? 0)) * 0.005 +
        (simOilTemp - (reading?.oil_temp_c ?? 0)) * 0.01))
      const simHealthDeg = Math.max(0, 100 - simHealth) / 100
      const simLoadContrib = (simLoad / 100) * 0.20
      const simFaultContrib = Math.min(Array.isArray(t.fault_history) ? t.fault_history.length : 0 / 5, 1) * 0.15
      const simScore = Math.min(1,
        simRisk * 0.30 + simHealthDeg * 0.25 + simLoadContrib + simFaultContrib +
        Math.min(complaintList.filter(c => c.transformer_id === t.id).length / 3, 1) * 0.10)

      return {
        ...b,
        score: simScore,
        level: priorityLevel(simScore).level,
        tone: priorityLevel(simScore).tone,
        _simulated: true,
      }
    })
  }, [board, whatIfMode, whatIfOverrides, complaintList])

  const feeders = Array.from(new Set(board.map(b => b.transformer.feeder_id))).sort()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-white/60 bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="p-4 lg:p-6">
          <div className="flex items-center gap-3 mb-2">
            <SlidersHorizontal className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold tracking-tight">Risk Prioritization</h1>
            <span className="ml-auto px-2 py-0.5 rounded border border-slate-200 text-[10px] font-semibold text-slate-500 uppercase">Transparent scoring — not a calibrated probability</span>
          </div>
          <p className="text-xs text-slate-500">
            Operational priority engine combining ML risk, health index, load, fault history, and complaints into a transparent score.
            What-if mode simulates parameter changes in isolation — no backend records are modified.
          </p>
        </div>
      </div>

      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Controls */}
        <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-3">Filters</p>
            <Select value={feederFilter} onChange={e => setFeederFilter(e.target.value)} className="w-full mb-2">
              <option value="">All feeders</option>
              {feeders.map(f => <option key={f} value={f}>{f}</option>)}
            </Select>
            <Select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="w-full mb-3">
              <option value="">All priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </Select>
            <button
              onClick={() => setWhatIfMode(!whatIfMode)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition ${whatIfMode ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
            >
              {whatIfMode ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {whatIfMode ? 'Exit what-if' : 'What-if simulation'}
            </button>
          </div>

          {whatIfMode && (
            <div className="p-3 space-y-3 overflow-y-auto flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">What-if parameters (isolated)</p>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span>Load utilization</span>
                    <span className="text-slate-500">{whatIfOverrides.load_pct}%</span>
                  </div>
                  <input
                    type="range" min="0" max="120" step="5"
                    value={whatIfOverrides.load_pct}
                    onChange={e => setWhatIfOverrides({ ...whatIfOverrides, load_pct: Number(e.target.value) })}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span>Oil temperature</span>
                    <span className="text-slate-500">{whatIfOverrides.oil_temp_c}°C</span>
                  </div>
                  <input
                    type="range" min="40" max="130" step="5"
                    value={whatIfOverrides.oil_temp_c}
                    onChange={e => setWhatIfOverrides({ ...whatIfOverrides, oil_temp_c: Number(e.target.value) })}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span>Health index</span>
                    <span className="text-slate-500">{whatIfOverrides.health_index}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" step="5"
                    value={whatIfOverrides.health_index}
                    onChange={e => setWhatIfOverrides({ ...whatIfOverrides, health_index: Number(e.target.value) })}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                </div>
                <p className="text-[9px] text-slate-500 italic">Simulated only — no backend records are modified. Reset by exiting what-if mode.</p>
              </div>
            </div>
          )}

          <div className="mt-auto p-3 border-t border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Quick actions</p>
            <NavLink to="/fault-investigation" className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition text-slate-600 hover:bg-slate-50">
              <FileText className="h-3 w-3" /> Fault investigation
            </NavLink>
          </div>
        </div>

        {/* Risk board */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Risk board</p>
              <h2 className="text-lg font-bold">{filtered.length} transformers</h2>
            </div>
            <div className="flex gap-2">
              {whatIfMode && (
                <span className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-[10px] font-bold text-blue-700">WHAT-IF MODE (isolated)</span>
              )}
              <Button variant="outline" size="sm" onClick={() => navigate('/digital-twin')}>
                <MapPin className="h-3 w-3" /> View on twin
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'score') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('score'); setSortDir('desc') }
                  }}>
                    Priority {sortKey === 'score' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'transformer') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('transformer'); setSortDir('asc') }
                  }}>
                    Transformer {sortKey === 'transformer' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'feeder') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('feeder'); setSortDir('asc') }
                  }}>
                    Feeder {sortKey === 'feeder' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'village') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('village'); setSortDir('asc') }
                  }}>
                    Village {sortKey === 'village' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'health') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('health'); setSortDir('asc') }
                  }}>
                    Health {sortKey === 'health' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'risk') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('risk'); setSortDir('desc') }
                  }}>
                    24h ML risk {sortKey === 'risk' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => {
                    if (sortKey === 'priority') setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                    else { setSortKey('priority'); setSortDir('asc') }
                  }}>
                    Urgency {sortKey === 'priority' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Data quality</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Factors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(b => (
                  <tr key={b.transformer.id} className="hover:bg-slate-50 transition group cursor-pointer" onClick={() => navigate(`/fault-investigation`)} >
                    <td className="px-4 py-3">
                      <div className={`w-20 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border ${b.tone === 'red' ? 'border-red-200 text-red-600 bg-red-50' : b.tone === 'orange' ? 'border-orange-200 text-orange-600 bg-orange-50' : b.tone === 'blue' ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-emerald-200 text-emerald-600 bg-emerald-50'}`}>
                        {Math.round(b.score * 100)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold">{b.transformer.id}</div>
                      <div className="text-[10px] text-slate-500">{b.transformer.village_name}</div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-600">{b.transformer.feeder_id}</td>
                    <td className="px-4 py-3 text-[10px] text-slate-600">{b.transformer.village_name}</td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-full rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" style={{ width: `${Math.max(0, Math.min(100, b.healthIndex))}%` }} />
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{b.healthIndex.toFixed(0)}/100</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={riskTone(b.riskLevel)} className="text-[10px]">{b.riskLevel}</Badge>
                      <div className="text-[10px] text-slate-500 mt-0.5">{Math.round(b.riskScore * 100)}%</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${b.tone === 'red' ? 'border-red-200 text-red-600 bg-red-50' : b.tone === 'orange' ? 'border-orange-200 text-orange-600 bg-orange-50' : b.tone === 'blue' ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-emerald-200 text-emerald-600 bg-emerald-50'}`}>
                        {b.level}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-0.5">{b.urgency}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border ${b.dataQuality.score >= 0.75 ? 'border-emerald-200 text-emerald-600 bg-emerald-50' : b.dataQuality.score >= 0.5 ? 'border-amber-200 text-amber-600 bg-amber-50' : 'border-red-200 text-red-600 bg-red-50'}`}>
                        {b.dataQuality.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-600 max-w-[200px] truncate">
                      {b.factors.length ? b.factors.join(' · ') : '—'}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="9" className="px-4 py-8 text-center text-slate-500">No transformers match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 p-4 rounded-lg border border-slate-100 bg-slate-50">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Scoring method</p>
            <p className="text-xs text-slate-600 mb-2">
              Priority score = (ML risk × 0.30) + (health degradation × 0.25) + (load utilization × 0.20) + (fault frequency × 0.15) + (open complaints × 0.10).
              {'Score ranges from 0 to 1. Levels: Critical ≥0.70, High ≥0.50, Medium ≥0.30, Low <0.30.'}
            </p>
            <p className="text-xs text-slate-500">
              <strong>Not a calibrated probability.</strong> This is an operational ranking tool for prioritizing field work, not a field-validated failure probability.
              All data is synthetic demonstration data. What-if simulations are isolated and do not modify any backend record.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
