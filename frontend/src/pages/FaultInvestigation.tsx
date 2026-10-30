import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Zap, Thermometer, AlertTriangle, ShieldCheck, Clock, Wrench, Bell, MapPin, Activity, FileText, ChevronRight,
} from 'lucide-react'
import { api } from '../api'
import { Badge, Button, Card, CardHeader, ErrorState, Select, Skeleton } from '../components/ui'
import type { Transformer, Complaint, AlertRecord } from '../types'

function riskTone(level: string) {
  return level === 'high' ? 'red' : level === 'warning' ? 'amber' : 'green'
}

function findingSeverity(type: string) {
  switch (type) {
    case 'overload': return 'critical'
    case 'high_oil_temp': return 'critical'
    case 'degraded_health': return 'high'
    case 'high_risk': return 'high'
    case 'prior_faults': return 'medium'
    case 'complaints': return 'medium'
    case 'missing_data': return 'low'
    case 'stale_telemetry': return 'low'
    default: return 'medium'
  }
}

function hypothesisLikelihood(type: string) {
  switch (type) {
    case 'thermal_stress': return 'likely'
    case 'degradation_risk': return 'likely'
    case 'recurring_faults': return 'possible'
    case 'cooling_degradation': return 'possible'
    case 'insulation_stress': return 'possible'
    default: return 'possible'
  }
}

interface ConfirmedFinding {
  id: string
  type: string
  label: string
  evidence: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

interface Hypothesis {
  id: string
  type: string
  label: string
  evidence: string
  likelihood: 'possible' | 'likely'
  confidence: number
}

interface RecommendedAction {
  id: string
  label: string
  reason: string
  urgent: boolean
}

function diagnose(
  transformer: Transformer | null,
  complaints: Complaint[],
  alerts: AlertRecord[],
  maintenance: { transformer_id: string; priority: string; recommended_action: string; due_in_days: number }[],
): { confirmed: ConfirmedFinding[]; hypotheses: Hypothesis[]; actions: RecommendedAction[] } {
  const confirmed: ConfirmedFinding[] = []
  const hypotheses: Hypothesis[] = []
  const actions: RecommendedAction[] = []

  if (!transformer) return { confirmed, hypotheses, actions }

  const reading = transformer.latest_reading
  const health = transformer.health
  const prediction = transformer.latest_prediction
  const faults = Array.isArray(transformer.fault_history) ? transformer.fault_history : []
  const telemetry = transformer.telemetry_status

  // --- Confirmed findings (directly observable from data) ---
  if (reading) {
    if (reading.load_pct >= 90) {
      confirmed.push({
        id: 'overload',
        type: 'overload',
        label: 'Transformer overloaded',
        evidence: `Load at ${reading.load_pct.toFixed(0)}% of ${transformer.capacity_kva} kVA capacity (observed ${reading.observed_at})`,
        severity: 'critical',
      })
      actions.push({ id: 'reduce-load', label: 'Reduce load or transfer to alternate feeder', reason: 'Load exceeds 90% of rated capacity', urgent: true })
    } else if (reading.load_pct >= 75) {
      confirmed.push({
        id: 'high-load',
        type: 'high_load',
        label: 'Elevated load',
        evidence: `Load at ${reading.load_pct.toFixed(0)}% of ${transformer.capacity_kva} kVA capacity`,
        severity: 'medium',
      })
    }
    if (reading.oil_temp_c >= 90) {
      confirmed.push({
        id: 'high-oil-temp',
        type: 'high_oil_temp',
        label: 'Critical oil temperature',
        evidence: `Oil temperature at ${reading.oil_temp_c.toFixed(0)}°C (critical threshold 90°C)`,
        severity: 'critical',
      })
      actions.push({ id: 'inspect-cooling', label: 'Inspect cooling system', reason: 'Oil temperature at critical threshold', urgent: true })
    } else if (reading.oil_temp_c >= 80) {
      confirmed.push({
        id: 'elevated-oil-temp',
        type: 'elevated_oil_temp',
        label: 'Elevated oil temperature',
        evidence: `Oil temperature at ${reading.oil_temp_c.toFixed(0)}°C`,
        severity: 'medium',
      })
    }
    if (reading.phase_imbalance_pct !== undefined && reading.phase_imbalance_pct >= 10) {
      confirmed.push({
        id: 'phase-imbalance',
        type: 'phase_imbalance',
        label: 'Phase imbalance',
        evidence: `Phase imbalance at ${reading.phase_imbalance_pct.toFixed(0)}%`,
        severity: 'high',
      })
      actions.push({ id: 'balance-phases', label: 'Balance phase loading', reason: 'Phase imbalance exceeds 10%', urgent: false })
    }
    if (reading.voltage_v !== undefined && reading.voltage_v < 200) {
      confirmed.push({
        id: 'low-voltage',
        type: 'low_voltage',
        label: 'Low voltage',
        evidence: `Voltage at ${reading.voltage_v.toFixed(0)}V`,
        severity: 'medium',
      })
    }
  }

  if (telemetry && telemetry.stale) {
    confirmed.push({
      id: 'stale-telemetry',
      type: 'stale_telemetry',
      label: 'Stale telemetry',
      evidence: `No reading for ${telemetry.age_hours.toFixed(1)} hours (stale after 2h)`,
      severity: 'low',
    })
    actions.push({ id: 'check-connectivity', label: 'Check telemetry connectivity', reason: 'Transformer readings are stale', urgent: false })
  }

  if (health) {
    if (health.overall_health_index < 50) {
      confirmed.push({
        id: 'degraded-health',
        type: 'degraded_health',
        label: 'Degraded health',
        evidence: `Health index ${health.overall_health_index.toFixed(0)}/100 (condition: ${health.condition})`,
        severity: 'high',
      })
      actions.push({ id: 'schedule-inspection', label: 'Schedule detailed inspection', reason: 'Health index below 50', urgent: true })
    } else if (health.overall_health_index < 70) {
      confirmed.push({
        id: 'declining-health',
        type: 'declining_health',
        label: 'Declining health',
        evidence: `Health index ${health.overall_health_index.toFixed(0)}/100 (condition: ${health.condition})`,
        severity: 'medium',
      })
    }
    if (health.missing_data_flags.length > 0) {
      confirmed.push({
        id: 'missing-data',
        type: 'missing_data',
        label: 'Missing data evidence',
        evidence: `Missing: ${health.missing_data_flags.join(', ')}`,
        severity: 'low',
      })
    }
  }

  if (prediction) {
    if (prediction.risk_level === 'high') {
      confirmed.push({
        id: 'high-risk',
        type: 'high_risk',
        label: 'High 24h fault risk',
        evidence: `ML risk score ${(prediction.risk_score * 100).toFixed(0)}% (model v${prediction.model_version ?? '?'})`,
        severity: 'high',
      })
      actions.push({ id: 'priority-monitoring', label: 'Place under priority monitoring', reason: 'High 24h fault risk from ML model', urgent: true })
    } else if (prediction.risk_level === 'warning') {
      confirmed.push({
        id: 'warning-risk',
        type: 'warning_risk',
        label: 'Elevated fault risk',
        evidence: `ML risk score ${(prediction.risk_score * 100).toFixed(0)}%`,
        severity: 'medium',
      })
    }
    if (prediction.top_factors?.length) {
      confirmed.push({
        id: 'risk-factors',
        type: 'risk_factors',
        label: 'Risk factors identified',
        evidence: prediction.top_factors.map(f => humanizeFactor(f)).join('; '),
        severity: 'medium',
      })
    }
  }

  if (faults.length > 0) {
    const recentFaults = faults.filter((f: any) => {
      const d = new Date(f.fault_at || f.occurred_at || f.created_at || '')
      return !isNaN(d.getTime()) && Date.now() - d.getTime() < 90 * 24 * 3600 * 1000
    })
    confirmed.push({
      id: 'prior-faults',
      type: 'prior_faults',
      label: 'Prior fault history',
      evidence: `${faults.length} fault(s) recorded${recentFaults.length ? `, ${recentFaults.length} in last 90 days` : ''}`,
      severity: 'medium',
    })
  }

  const assetComplaints = complaints.filter(c => c.transformer_id === transformer.id)
  if (assetComplaints.length > 0) {
    const openComplaints = assetComplaints.filter(c => c.status !== 'resolved' && c.status !== 'closed')
    confirmed.push({
      id: 'complaints',
      type: 'complaints',
      label: 'Customer complaints',
      evidence: `${assetComplaints.length} complaint(s)${openComplaints.length ? `, ${openComplaints.length} open` : ''}`,
      severity: openComplaints.length > 0 ? 'high' : 'medium',
    })
    if (openComplaints.length > 0) {
      actions.push({ id: 'respond-complaints', label: 'Respond to open complaints', reason: `${openComplaints.length} unresolved customer complaint(s)`, urgent: false })
    }
  }

  const assetAlerts = alerts.filter(a => a.transformer_id === transformer.id)
  const criticalAlerts = assetAlerts.filter(a => a.severity === 'critical')
  if (assetAlerts.length > 0) {
    confirmed.push({
      id: 'alerts',
      type: 'alerts',
      label: 'Active alerts',
      evidence: `${assetAlerts.length} alert(s)${criticalAlerts.length ? `, ${criticalAlerts.length} critical` : ''}`,
      severity: criticalAlerts.length > 0 ? 'critical' : 'high',
    })
  }

  const assetMaintenance = maintenance.filter(m => m.transformer_id === transformer.id)
  const overdue = assetMaintenance.filter(m => m.due_in_days <= 0)
  if (overdue.length > 0) {
    confirmed.push({
      id: 'overdue-maintenance',
      type: 'overdue_maintenance',
      label: 'Overdue maintenance',
      evidence: `${overdue.length} maintenance item(s) past due`,
      severity: 'high',
    })
    actions.push({ id: 'schedule-maintenance', label: 'Schedule overdue maintenance', reason: 'Maintenance past due', urgent: true })
  } else if (assetMaintenance.length > 0) {
    confirmed.push({
      id: 'pending-maintenance',
      type: 'pending_maintenance',
      label: 'Pending maintenance',
      evidence: `${assetMaintenance.length} scheduled item(s)`,
      severity: 'low',
    })
  }

  // --- Hypotheses (inferred possibilities, not confirmed) ---
  if (reading && reading.load_pct >= 75 && reading.oil_temp_c >= 80) {
    hypotheses.push({
      id: 'thermal-stress',
      type: 'thermal_stress',
      label: 'Possible thermal stress',
      evidence: 'High load combined with elevated oil temperature suggests thermal stress on windings and insulation',
      likelihood: 'likely',
      confidence: 0.7,
    })
  }
  if (health && health.overall_health_index < 60 && prediction && prediction.risk_level === 'high') {
    hypotheses.push({
      id: 'degradation-risk',
      type: 'degradation_risk',
      label: 'Possible accelerated degradation',
      evidence: 'Low health index combined with high ML risk score suggests accelerating asset degradation',
      likelihood: 'likely',
      confidence: 0.65,
    })
  }
  if (faults.length > 2) {
    hypotheses.push({
      id: 'recurring-faults',
      type: 'recurring_faults',
      label: 'Possible recurring fault root cause',
      evidence: 'Multiple prior faults recorded suggest an unresolved underlying issue',
      likelihood: 'possible',
      confidence: 0.55,
    })
  }
  if (reading && reading.oil_temp_c >= 80 && reading.ambient_temp_c !== undefined && reading.oil_temp_c - reading.ambient_temp_c > 40) {
    hypotheses.push({
      id: 'cooling-degradation',
      type: 'cooling_degradation',
      label: 'Possible cooling system degradation',
      evidence: `Oil-to-ambient temperature spread of ${(reading.oil_temp_c - reading.ambient_temp_c).toFixed(0)}°C suggests reduced cooling effectiveness`,
      likelihood: 'possible',
      confidence: 0.5,
    })
  }
  if (reading && reading.load_pct >= 85 && prediction && prediction.risk_level === 'high') {
    hypotheses.push({
      id: 'insulation-stress',
      type: 'insulation_stress',
      label: 'Possible insulation stress',
      evidence: 'High sustained load combined with high fault risk suggests possible insulation stress',
      likelihood: 'possible',
      confidence: 0.5,
    })
  }

  // Sort: confirmed by severity, hypotheses by confidence
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  confirmed.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  hypotheses.sort((a, b) => b.confidence - a.confidence)

  return { confirmed, hypotheses, actions }
}

function humanizeFactor(f: string): string {
  return f
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function FaultInvestigationPage() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
  const maintenance = useQuery<{ transformer_id: string; priority: string; recommended_action: string; due_in_days: number }[]>({
    queryKey: ['maintenance-recommendations'],
    queryFn: () => api('/api/maintenance/recommendations').then(r => r.recommendations ?? []),
  })

  const loading = transformers.isLoading || complaints.isLoading || alerts.isLoading || maintenance.isLoading
  if (loading) return <Skeleton count={6} />

  const txList = transformers.data ?? []
  const complaintList = complaints.data ?? []
  const alertList = alerts.data ?? []
  const maintenanceList = maintenance.data ?? []

  const selected = txList.find(t => t.id === selectedId)
  const diagnosis = useMemo(() => diagnose(selected, complaintList, alertList, maintenanceList), [selected, complaintList, alertList, maintenanceList])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-white/60 bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="p-4 lg:p-6">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold tracking-tight">Fault Investigation</h1>
            <span className="ml-auto px-2 py-0.5 rounded border border-slate-200 text-[10px] font-semibold text-slate-500 uppercase">Advisory only — no automatic switching</span>
          </div>
          <p className="text-xs text-slate-500">Rule-based diagnostic assistant grounded in telemetry, health index, faults, maintenance, complaints, alerts, and ML predictions. Confirmed findings are directly observable; hypotheses are inferred possibilities.</p>
        </div>
      </div>

      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Transformer selector */}
        <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Select transformer</p>
            <div className="mt-2 space-y-1">
              {txList.map(t => {
                const risk = t.latest_prediction?.risk_level ?? 'low'
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition text-sm ${selectedId === t.id ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Badge variant={riskTone(risk)} className="h-6 w-6 text-[10px] leading-none">{risk}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{t.id}</div>
                      <div className="text-[10px] text-slate-500 truncate">{t.village_name} · {t.feeder_id}</div>
                    </div>
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                  </button>
                )
              })}
            </div>
          </div>
          {txList.length === 0 && (
            <div className="p-3 text-[10px] text-slate-500 text-center">No transformers</div>
          )}
        </div>

        {/* Investigation panel */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          {!selectedId ? (
            <div className="max-w-2xl mx-auto text-center pt-20">
              <Zap className="h-12 w-12 mx-auto text-slate-300 mb-3" />
              <h2 className="text-lg font-semibold text-slate-900">Select a transformer to investigate</h2>
              <p className="text-slate-500 mt-1">Choose a transformer from the list to see confirmed findings, hypotheses, and recommended actions.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Investigation</p>
                  <h2 className="text-2xl font-bold">{selected?.id}</h2>
                  <p className="text-slate-500">{selected?.village_name} · {selected?.feeder_id} · {selected?.capacity_kva} kVA · {selected?.age_years} yrs</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate(`/transformers/${selected?.id}`)}>View asset details</Button>
                  <Button size="sm" onClick={() => navigate(`/simulation?transformer=${selected?.id}`)}>Run simulation</Button>
                </div>
              </div>

              {/* Confirmed findings */}
              <Card>
                <CardHeader title="Confirmed findings" subtitle={`Directly observable evidence · ${diagnosis.confirmed.length} finding(s)`} />
                <div className="p-4 space-y-3">
                  {diagnosis.confirmed.length === 0 ? (
                    <p className="text-xs text-slate-500">No confirmed findings — all telemetry within normal ranges.</p>
                  ) : (
                    diagnosis.confirmed.map(f => (
                      <div key={f.id} className="flex gap-3 p-3 rounded-lg border border-slate-100 bg-white">
                        <div className={`mt-0.5 grid h-8 w-8 place-items-center rounded ${f.severity === 'critical' ? 'bg-red-50' : f.severity === 'high' ? 'bg-amber-50' : f.severity === 'medium' ? 'bg-blue-50' : 'bg-emerald-50'}`}>
                          <AlertTriangle className={`h-4 w-4 ${f.severity === 'critical' ? 'text-red-600' : f.severity === 'high' ? 'text-amber-600' : f.severity === 'medium' ? 'text-blue-600' : 'text-emerald-600'}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-sm font-bold">{f.label}</p>
                            <Badge variant={f.severity === 'critical' ? 'red' : f.severity === 'high' ? 'orange' : f.severity === 'medium' ? 'blue' : 'green'} className="text-[10px]">{f.severity}</Badge>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">{f.evidence}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              {/* Hypotheses */}
              <Card>
                <CardHeader title="Hypotheses (inferred)" subtitle={`Not confirmed — possible causes for further review · ${diagnosis.hypotheses.length}`} />
                <div className="p-4 space-y-3">
                  {diagnosis.hypotheses.length === 0 ? (
                    <p className="text-xs text-slate-500">No hypotheses — no inferred risk patterns detected.</p>
                  ) : (
                    diagnosis.hypotheses.map(h => (
                      <div key={h.id} className="flex gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
                        <div className="mt-0.5 grid h-8 w-8 place-items-center rounded bg-blue-50 text-blue-600">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-sm font-bold">{h.label}</p>
                            <Badge variant="blue" className="text-[10px]">{h.likelihood}</Badge>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">{h.evidence}</p>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Confidence</span>
                            <div className="h-1.5 w-full rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(h.confidence * 100)}%` }} /></div>
                            <span className="text-[9px] font-bold text-slate-500">{Math.round(h.confidence * 100)}%</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <p className="text-[10px] text-slate-400 italic mt-2">Hypotheses are inferred from combinations of evidence and require field verification. They are not confirmed diagnoses.</p>
                </div>
              </Card>

              {/* Recommended actions */}
              <Card>
                <CardHeader title="Recommended actions" subtitle={`Advisory only — all actions require qualified utility engineering review · ${diagnosis.actions.length}`} />
                <div className="p-4 space-y-3">
                  {diagnosis.actions.length === 0 ? (
                    <p className="text-xs text-slate-500">No actions recommended — continue routine monitoring.</p>
                  ) : (
                    diagnosis.actions.map(a => (
                      <div key={a.id} className={`flex gap-3 p-3 rounded-lg border ${a.urgent ? 'border-red-100 bg-red-50' : 'border-slate-100 bg-white'}`}>
                        <div className={`mt-0.5 grid h-8 w-8 place-items-center rounded ${a.urgent ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                          {a.urgent ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold">{a.label}</p>
                          <p className="text-xs text-slate-600 mt-0.5">{a.reason}</p>
                        </div>
                      </div>
                    ))
                  )}
                  <p className="text-[10px] text-slate-400 italic mt-2">This system provides advisory recommendations only. No automatic switching or control commands are issued. All actions require qualified utility engineering review.</p>
                </div>
              </Card>

              {/* Evidence summary */}
              <Card>
                <CardHeader title="Evidence summary" subtitle="All data sources consulted for this investigation" />
                <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <EvidenceTile icon={Thermometer} label="Telemetry" value={selected?.latest_reading ? `${selected.latest_reading.load_pct.toFixed(0)}% load` : '—'} />
                  <EvidenceTile icon={ShieldCheck} label="Health" value={selected?.health ? `${selected.health.overall_health_index.toFixed(0)}/100` : '—'} />
                  <EvidenceTile icon={AlertTriangle} label="Faults" value={Array.isArray(selected?.fault_history) ? selected.fault_history.length : 0} />
                  <EvidenceTile icon={Wrench} label="Maintenance" value={maintenanceList.filter(m => m.transformer_id === selected?.id).length} />
                  <EvidenceTile icon={Bell} label="Complaints" value={complaintList.filter(c => c.transformer_id === selected?.id).length} />
                  <EvidenceTile icon={MapPin} label="Alerts" value={alertList.filter(a => a.transformer_id === selected?.id).length} />
                  <EvidenceTile icon={Activity} label="ML Risk" value={selected?.latest_prediction ? `${(selected.latest_prediction.risk_score * 100).toFixed(0)}%` : '—'} />
                </div>
                <div className="mt-3 p-3 rounded-lg border border-slate-100 bg-slate-50 text-[10px] text-slate-500">
                  <strong>Data source:</strong> Synthetic demonstration data. All readings, predictions, and events are simulated for demonstration purposes. Not connected to live SCADA.
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EvidenceTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="grid h-7 w-7 place-items-center rounded bg-blue-50 text-blue-600 mb-2"><Icon className="h-3.5 w-3.5" /></div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold">{value}</p>
    </div>
  )
}
