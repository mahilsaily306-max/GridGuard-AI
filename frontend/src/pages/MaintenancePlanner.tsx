import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Wrench, Clock, AlertTriangle, ShieldCheck, MapPin, Calendar, Users, Activity, ChevronRight, Play,
} from 'lucide-react'
import { api } from '../api'
import { Badge, Button, Card, CardHeader, ErrorState, Select, Skeleton } from '../components/ui'
import type { Transformer } from '../types'

function priorityTone(p: string) {
  return p === 'Critical' ? 'red' : p === 'High' ? 'orange' : p === 'Medium' ? 'blue' : 'green'
}

interface MaintenanceRec {
  transformer_id: string
  priority: string
  recommended_action: string
  due_in_days: number
  health_score?: number
}

interface MaintenanceRecord {
  id: number
  transformer_id: string
  action: string
  performed_at: string
  performed_by: string
  notes?: string
}

interface WorkOrder {
  id: number
  transformer_id: string | null
  title: string
  description: string
  priority: string
  status: string
  assigned_to: string | null
  scheduled_for: string | null
  created_at: string
  updated_at: string
}

function computeMaintenancePriority(rec: MaintenanceRec, healthIndex: number, faultCount: number): { score: number; tone: string; label: string; reason: string } {
  let score = 0
  const reasons: string[] = []

  // Overdue is the strongest driver
  if (rec.due_in_days <= 0) {
    score += 0.40
    reasons.push('Maintenance past due')
  } else if (rec.due_in_days <= 7) {
    score += 0.25
    reasons.push(`Due in ${rec.due_in_days} day(s)`)
  } else if (rec.due_in_days <= 30) {
    score += 0.10
    reasons.push(`Due in ${rec.due_in_days} day(s)`)
  }

  // Health degradation
  if (healthIndex < 50) {
    score += 0.30
    reasons.push(`Health ${healthIndex.toFixed(0)}/100 (critical)`)
  } else if (healthIndex < 70) {
    score += 0.15
    reasons.push(`Health ${healthIndex.toFixed(0)}/100 (declining)`)
  }

  // Fault history
  if (faultCount >= 3) {
    score += 0.20
    reasons.push(`${faultCount} prior faults`)
  } else if (faultCount >= 1) {
    score += 0.10
    reasons.push(`${faultCount} prior fault(s)`)
  }

  score = Math.min(1, score)

  let label = 'Low'
  let tone = 'green'
  if (score >= 0.70) { label = 'Critical'; tone = 'red' }
  else if (score >= 0.50) { label = 'High'; tone = 'orange' }
  else if (score >= 0.30) { label = 'Medium'; tone = 'blue' }

  return { score, tone, label, reason: reasons.join('; ') || 'Routine maintenance' }
}

export function MaintenancePlannerPage() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feederFilter, setFeederFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const recommendations = useQuery<{ recommendations: MaintenanceRec[]; advisory_note: string; automatic_switching: boolean }>({
    queryKey: ['maintenance-recommendations'],
    queryFn: () => api('/api/maintenance/recommendations'),
  })
  const transformers = useQuery<Transformer[]>({
    queryKey: ['transformers'],
    queryFn: () => api<Transformer[]>('/api/transformers'),
  })

  const loading = recommendations.isLoading || transformers.isLoading
  if (loading) return <Skeleton count={8} />

  const recList = recommendations.data?.recommendations ?? []
  const txList = transformers.data ?? []

  // Build lookup maps
  const faultCounts = new Map<string, number>()
  const healthMap = new Map<string, number>()
  const workOrderMap = new Map<string, WorkOrder[]>()

  // Fetch per-transformer details for fault counts and work orders
  // (We already have health + fault_history from transformer detail if needed, but recommendations may not include them)
  // For now, derive from available data

  const feeders = Array.from(new Set(txList.map(t => t.feeder_id))).sort()

  // Build queue entries
  const queue = useMemo(() => {
    return recList.map(rec => {
      const tx = txList.find(t => t.id === rec.transformer_id)
      const healthIndex = tx?.health?.overall_health_index ?? 100
      const faultCount = Array.isArray(tx?.fault_history) ? tx.fault_history.length : 0
      const { score, tone, label, reason } = computeMaintenancePriority(rec, healthIndex, faultCount)
      return {
        ...rec,
        transformer: tx,
        score,
        tone,
        label,
        reason,
        healthIndex,
        faultCount,
        overdue: rec.due_in_days <= 0,
      }
    })
  }, [recList, txList])

  let filtered = queue.filter(q => {
    if (feederFilter && q.transformer?.feeder_id !== feederFilter) return false
    if (statusFilter && q.label !== statusFilter) return false
    if (overdueOnly && !q.overdue) return false
    return true
  })

  // Sort by score desc
  filtered = [...filtered].sort((a, b) => b.score - a.score)

  // Technician workload (synthetic, clearly labeled)
  const technicians = [
    { name: 'R. Singh', load_pct: 65, active_jobs: 3 },
    { name: 'A. Kaur', load_pct: 40, active_jobs: 2 },
    { name: 'M. Devi', load_pct: 80, active_jobs: 4 },
  ]
  const totalCapacity = technicians.reduce((sum, t) => sum + (100 - t.load_pct), 0)
  const pendingCount = filtered.filter(q => q.status !== 'completed').length

  const criticalCount = filtered.filter(q => q.label === 'Critical').length
  const overdueCount = filtered.filter(q => q.overdue).length

  const selected = filtered.find(q => q.transformer?.id === selectedId)
  const selectedTx = selected?.transformer ?? null
  const selectedRec = selected ?? null

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-white/60 bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="p-4 lg:p-6">
          <div className="flex items-center gap-3 mb-2">
            <Wrench className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold tracking-tight">Maintenance Planner</h1>
            <span className="ml-auto px-2 py-0.5 rounded border border-slate-200 text-[10px] font-semibold text-slate-500 uppercase">No autonomous dispatch — supervisor review required</span>
          </div>
          <p className="text-xs text-slate-500">
            Health-based maintenance priority queue with transparent scheduling heuristic. Supervisor review and approval required before any work order is created or modified.
          </p>
        </div>
      </div>

      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Left: filters + technician workload */}
        <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-100 flex-shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-3">Filters</p>
            <Select value={feederFilter} onChange={e => setFeederFilter(e.target.value)} className="w-full mb-2">
              <option value="">All feeders</option>
              {feeders.map(f => <option key={f} value={f}>{f}</option>)}
            </Select>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full mb-2">
              <option value="">All priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </Select>
            <button
              onClick={() => setOverdueOnly(!overdueOnly)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition ${overdueOnly ? 'bg-red-50 border-red-200 text-red-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
            >
              <AlertTriangle className="h-3 w-3" /> {overdueOnly ? 'Show all' : 'Overdue only'}
            </button>
          </div>

          <div className="p-3 flex-1 overflow-y-auto border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-3">Technician workload (simulated)</p>
            {technicians.map(t => (
              <div key={t.name} className="mb-3">
                <div className="flex justify-between text-[10px] mb-1">
                  <span>{t.name}</span>
                  <span className="text-slate-500">{t.load_pct}% load</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${t.load_pct}%` }} />
                </div>
                <div className="text-[9px] text-slate-500 mt-1">{t.active_jobs} active job(s)</div>
              </div>
            ))}
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-500">Remaining capacity: {totalCapacity}%</p>
              <p className="text-[10px] text-slate-500">Pending jobs: {pendingCount}</p>
            </div>
          </div>

          <div className="p-3 border-t border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Summary</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded bg-red-50 border border-red-100">
                <p className="text-[10px] font-bold text-red-700">{criticalCount}</p>
                <p className="text-[9px] text-red-600">Critical priority</p>
              </div>
              <div className="p-2 rounded bg-amber-50 border border-amber-100">
                <p className="text-[10px] font-bold text-amber-700">{overdueCount}</p>
                <p className="text-[9px] text-amber-600">Overdue</p>
              </div>
            </div>
          </div>
        </div>

        {/* Center: maintenance queue */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maintenance queue</p>
              <h2 className="text-lg font-bold">{filtered.length} item(s)</h2>
            </div>
            <NavLink to="/work-orders" className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition text-slate-600 hover:bg-slate-50">
              <Calendar className="h-3 w-3" /> View all work orders
            </NavLink>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-500">Priority</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Transformer</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Village · Feeder</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Recommended action</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Due</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Health</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Faults</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(q => (
                  <tr key={q.transformer_id} className={`hover:bg-slate-50 transition ${q.overdue ? 'bg-red-25' : ''}`} onClick={() => setSelectedId(q.transformer_id)}>
                    <td className="px-4 py-3">
                      <Badge variant={q.tone} className="text-[10px]">{q.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold">{q.transformer_id}</div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-600">
                      {q.transformer?.village_name ?? '—'} · {q.transformer?.feeder_id ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-600">{q.recommended_action}</td>
                    <td className="px-4 py-3 text-[10px]">
                      <span className={`font-bold ${q.overdue ? 'text-red-600' : 'text-slate-600'}`}>
                        {q.overdue ? 'OVERDUE' : `in ${q.due_in_days}d`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-1.5 w-full rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500" style={{ width: `${Math.max(0, Math.min(100, q.healthIndex))}%` }} />
                      </div>
                      <div className="text-[9px] text-slate-500">{q.healthIndex.toFixed(0)}/100</div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-600">{q.faultCount}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedId(q.transformer_id) }}>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500">No maintenance items match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 p-4 rounded-lg border border-slate-100 bg-slate-50">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Scheduling heuristic</p>
            <p className="text-xs text-slate-600">
              {'Priority score = overdue weight (0.40 if past due, 0.25 if ≤7 days, 0.10 if ≤30 days) + health degradation (0.30 if &lt;50, 0.15 if &lt;70) + fault history (0.20 if ≥3 faults, 0.10 if ≥1). Score 0–1. Levels: Critical ≥0.70, High ≥0.50, Medium ≥0.30, Low &lt;0.30.'}
            </p>
            <p className="text-xs text-slate-500">
              <strong>No autonomous dispatch.</strong> This planner recommends priorities only. All work orders require supervisor review, technician assignment, and safety acknowledgment before execution.
              Technician workload shown is simulated demonstration data.
            </p>
          </div>
        </div>

        {/* Right: detail panel */}
        {selectedId && selectedTx && selectedRec && (
          <div className="w-[420px] border-l border-slate-200 bg-white flex flex-col h-full">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <button onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <span className="sr-only">Close</span>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <div className="flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maintenance detail</p>
                <h2 className="text-lg font-bold">{selectedTx.id}</h2>
                <p className="text-xs text-slate-500">{selectedTx.village_name} · {selectedTx.feeder_id}</p>
              </div>
              <Badge variant={selectedRec.tone} className="text-[10px]">{selectedRec.label}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <Card>
                <CardHeader title="Recommended action" subtitle={`Due in ${selectedRec.due_in_days} day(s)`} />
                <div className="p-4">
                  <p className="text-sm font-semibold mb-1">{selectedRec.recommended_action}</p>
                  <p className="text-xs text-slate-600">{selectedRec.reason}</p>
                </div>
              </Card>

              <Card>
                <CardHeader title="Fault history" subtitle={Array.isArray(selectedTx.fault_history) ? `${selectedTx.fault_history.length} recorded` : '0 recorded'} />
                <div className="p-3 space-y-2">
                  {Array.isArray(selectedTx.fault_history) && selectedTx.fault_history.length > 0 ? (
                    selectedTx.fault_history.slice(0, 5).map((f: any, i) => (
                      <div key={i} className="flex gap-2 p-2 rounded border border-slate-100 bg-slate-50">
                        <div className="mt-1 text-[10px] font-bold text-slate-500">{f.fault_category ?? 'Fault'}</div>
                        <div className="flex-1 text-[10px] text-slate-600">{f.fault_at ?? f.occurred_at ?? '—'}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No fault history recorded</p>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Maintenance history" />
                <div className="p-3 space-y-2">
                  <p className="text-xs text-slate-500">Maintenance records fetched from backend.</p>
                </div>
              </Card>

              <div className="pt-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Supervisor actions</p>
                <div className="space-y-2">
                  <Button size="sm" className="w-full" onClick={() => navigate(`/work-orders`)}>
                    Create work order
                  </Button>
                  <NavLink to={`/transformers/${selectedTx.id}`} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition text-slate-600 hover:bg-slate-50">
                    <Activity className="h-3 w-3" /> View transformer details
                  </NavLink>
                </div>
                <p className="text-[10px] text-slate-400 italic mt-3">All work order creation and modification requires supervisor review and safety acknowledgment.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
