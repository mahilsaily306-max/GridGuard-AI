import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, FlaskConical, Save, ShieldCheck, Thermometer, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Badge, Button, Card, CardHeader, ErrorState, Select } from '../components/ui'
import type { Transformer } from '../types'

interface SimulationResult {
  transformer_id: string
  original_readings: Record<string, number>
  simulated_readings: Record<string, number>
  original_model_prediction: { risk_score: number; risk_level: string }
  simulated_model_prediction: { risk_score: number; risk_level: string; top_factors: string[] }
  risk_score_change: number
  original_health_score: number
  simulated_health_score: number
  warning_messages: string[]
  recommended_next_actions: string[]
  model_version: string
  historical_telemetry_modified: boolean
}

const presets: Record<string, { load: number; oil: number; ambient: number; rainfall: number }> = {
  Normal: { load: 65, oil: 68, ambient: 30, rainfall: 0 },
  'High Load': { load: 118, oil: 92, ambient: 34, rainfall: 0 },
  Heatwave: { load: 92, oil: 98, ambient: 47, rainfall: 0 },
  'Cooling Failure': { load: 96, oil: 115, ambient: 36, rainfall: 0 },
  Storm: { load: 88, oil: 82, ambient: 27, rainfall: 75 },
  'Combined Stress': { load: 132, oil: 118, ambient: 45, rainfall: 45 },
}

export function SimulationPage() {
  const [params] = useSearchParams()
  const transformers = useQuery({ queryKey: ['transformers'], queryFn: () => api<Transformer[]>('/api/transformers') })
  const [transformer, setTransformer] = useState(params.get('transformer') ?? 'T-101')
  const [values, setValues] = useState(presets.Normal)
  const [result, setResult] = useState<SimulationResult | null>(null)
  useEffect(() => { if (params.get('transformer')) setTransformer(params.get('transformer')!) }, [params])
  const run = useMutation({ mutationFn: () => api<SimulationResult>('/api/simulations/transformer-risk', { method: 'POST', body: JSON.stringify({ transformer_id: transformer, overrides: { load_utilization_pct: values.load, oil_temperature_c: values.oil, ambient_temperature_c: values.ambient, rainfall_mm: values.rainfall } }) }), onSuccess: setResult })
  const save = useMutation({ mutationFn: () => api('/api/simulation-scenarios', { method: 'POST', body: JSON.stringify({ name: `Scenario ${new Date().toLocaleTimeString()}`, transformer_id: transformer, inputs: values, result }) }) })
  return <div className="space-y-4 p-4 lg:p-6"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Safe sandbox</p><h1 className="text-2xl font-bold">Simulation Lab</h1><p className="text-sm text-slate-500">Compare what-if conditions against the persisted baseline.</p></div><div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-center text-xs font-bold text-blue-800">SIMULATION — DOES NOT CHANGE OPERATIONAL DATA</div><div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]"><Card><CardHeader title="Scenario Controls" subtitle="Only inputs handled by the model and health engine are exposed"/><div className="space-y-5 p-5"><label className="text-xs font-semibold">Transformer<Select className="mt-2" value={transformer} onChange={event => { setTransformer(event.target.value); setResult(null) }}>{transformers.data?.map(item => <option key={item.id} value={item.id}>{item.id} — {item.village_name}</option>)}</Select></label><div><p className="mb-2 text-xs font-semibold">Presets</p><div className="flex flex-wrap gap-2">{Object.entries(presets).map(([name, preset]) => <Button key={name} variant="secondary" className="min-h-8 px-3 py-1 text-xs" onClick={() => { setValues(preset); setResult(null) }}>{name}</Button>)}</div></div><Slider label="Load utilization" unit="%" min={0} max={180} value={values.load} onChange={load => setValues({ ...values, load })}/><Slider label="Oil temperature" unit="°C" min={20} max={150} value={values.oil} onChange={oil => setValues({ ...values, oil })}/><Slider label="Ambient temperature" unit="°C" min={-10} max={65} value={values.ambient} onChange={ambient => setValues({ ...values, ambient })}/><Slider label="Rainfall" unit="mm" min={0} max={150} value={values.rainfall} onChange={rainfall => setValues({ ...values, rainfall })}/><div className="grid grid-cols-2 gap-3"><Button onClick={() => run.mutate()} disabled={run.isPending}><FlaskConical className="h-4 w-4"/>{run.isPending ? 'Running…' : 'Run Simulation'}</Button><Button variant="secondary" onClick={() => { setValues(presets.Normal); setResult(null) }}>Reset</Button></div>{run.isError && <ErrorState error={run.error}/>}</div></Card><Card><CardHeader title="Simulation Result" subtitle={result ? `${result.model_version} · non-persistent inference` : 'Run a scenario to compare risk and health'} action={result && <Badge tone={result.simulated_model_prediction.risk_level === 'high' ? 'red' : 'amber'}>{result.simulated_model_prediction.risk_level} risk</Badge>}/>{!result ? <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-blue-50 text-blue-600"><FlaskConical/></div><p className="mt-4 font-semibold">Ready for safe what-if analysis</p><p className="mt-1 text-sm text-slate-500">Operational telemetry, verified faults, alerts, and incidents remain untouched.</p></div></div> : <div className="space-y-5 p-5"><div className="grid gap-3 sm:grid-cols-2"><DeltaCard title="24-hour ML score" before={result.original_model_prediction.risk_score * 100} after={result.simulated_model_prediction.risk_score * 100} unit="%"/><DeltaCard title="Health index" before={result.original_health_score} after={result.simulated_health_score} unit="/100"/></div><div className="grid gap-3 sm:grid-cols-4"><ResultMetric icon={Zap} label="Load" value={`${result.simulated_readings.load_pct}%`}/><ResultMetric icon={Thermometer} label="Oil" value={`${result.simulated_readings.oil_temp_c} °C`}/><ResultMetric icon={Thermometer} label="Ambient" value={`${result.simulated_readings.ambient_temp_c} °C`}/><ResultMetric icon={ShieldCheck} label="History changed" value={result.historical_telemetry_modified ? 'Yes' : 'No'}/></div>{result.warning_messages.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-4"><div className="flex gap-2 font-bold text-red-700"><AlertTriangle className="h-5 w-5"/>Simulated warnings</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">{result.warning_messages.map(item => <li key={item}>{item}</li>)}</ul></div>}<div><p className="text-sm font-semibold">Contributing evidence</p><div className="mt-2 space-y-2">{result.simulated_model_prediction.top_factors.map((factor, index) => <div key={factor} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{index + 1}</span>{factor}</div>)}</div></div><div className="rounded-xl bg-emerald-50 p-4"><p className="font-semibold text-emerald-800">Recommended next actions</p><ul className="mt-2 list-disc pl-5 text-sm text-emerald-800">{result.recommended_next_actions.map(item => <li key={item}>{item}</li>)}</ul></div><Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4"/>{save.isSuccess ? 'Scenario saved' : 'Save Scenario'}</Button></div>}</Card></div></div>
}

function Slider({ label, unit, min, max, value, onChange }: { label: string; unit: string; min: number; max: number; value: number; onChange: (value: number) => void }) { return <label className="block"><div className="mb-2 flex justify-between text-xs font-semibold"><span>{label}</span><span className="rounded bg-slate-100 px-2 py-1">{value} {unit}</span></div><input className="w-full accent-blue-600" type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))}/><div className="flex justify-between text-[9px] text-slate-400"><span>{min}</span><span>{max}</span></div></label> }
function DeltaCard({ title, before, after, unit }: { title: string; before: number; after: number; unit: string }) { const delta = after - before; return <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold text-slate-500">{title}</p><div className="mt-2 flex items-end justify-between"><div><span className="text-sm text-slate-400 line-through">{before.toFixed(1)}</span><p className="text-3xl font-bold">{after.toFixed(1)}<span className="text-xs text-slate-500"> {unit}</span></p></div><Badge tone={delta > 0 ? 'red' : 'green'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}</Badge></div></div> }
function ResultMetric({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><Icon className="h-4 w-4 text-blue-600"/><p className="mt-2 text-[9px] uppercase text-slate-400">{label}</p><p className="text-sm font-bold">{value}</p></div> }
