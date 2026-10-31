import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, BrainCircuit, Database, RefreshCw, ShieldAlert, Target } from 'lucide-react'
import { api, humanize } from '../api'
import { Badge, Button, Card, CardHeader, ErrorState, Skeleton } from '../components/ui'

type ScoreSet = {
  precision: number
  recall: number
  f1: number
  pr_auc: number
  confusion_matrix: [[number, number], [number, number]]
}

type Metrics = {
  model_version: string
  model_type: string
  generator_version: string
  data_source: string
  evaluation_note: string
  split: {
    strategy: string
    train_rows: number
    test_rows: number
    train_end: string
    test_start: string
  }
  class_balance: {
    train_positive_rate: number
    test_positive_rate: number
  }
  random_forest: ScoreSet
  threshold_baseline: ScoreSet
  permutation_importance_held_out: Array<{ feature: string; importance: number }>
  feature_order: string[]
}

const featureDescriptions: Record<string, string> = {
  load_pct: 'Current transformer load as a percentage of rated capacity.',
  oil_temp_c: 'Current transformer oil temperature in degrees Celsius.',
  ambient_temp_c: 'Current ambient air temperature in degrees Celsius.',
  rainfall_mm: 'Synthetic rainfall exposure associated with the observation.',
  age_years: 'Transformer age in completed years.',
  faults_last_90d: 'Count of earlier synthetic fault events in the preceding 90 days.',
  overload_hours_24h: 'Hours above the overload threshold in the preceding 24 hours.',
  load_avg_24h: 'Average load over the preceding 24 hours.',
  temp_change_6h: 'Change in oil temperature relative to six hours earlier.',
  hour_sin: 'Sine encoding of hour-of-day for daily operating patterns.',
  hour_cos: 'Cosine encoding of hour-of-day for daily operating patterns.',
}

const metricHelp = {
  precision: 'Of the cases flagged positive, the share that were synthetic future-fault cases. Higher precision means fewer false alarms.',
  recall: 'Of all synthetic future-fault cases, the share detected. Higher recall means fewer missed cases.',
  f1: 'A combined summary of precision and recall. It is useful when both false alarms and missed cases matter.',
  pr_auc: 'Area under the precision-recall curve across score thresholds. It is suited to an imbalanced positive class.',
}

export function ModelEvaluationPage() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['model-metrics'], queryFn: () => api<Metrics>('/api/ml/metrics') })
  const train = useMutation({
    mutationFn: () => api('/api/ml/train', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['model-metrics'] }),
  })

  return <div className="space-y-4 p-4 lg:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Transparent evaluation</p>
        <h1 className="text-2xl font-bold">Model Evaluation</h1>
        <p className="text-sm text-slate-500">Artifact-backed evaluation of the deterministic Random Forest pipeline.</p>
      </div>
      <Button onClick={() => train.mutate()} disabled={train.isPending}>
        <RefreshCw className={`h-4 w-4 ${train.isPending ? 'animate-spin' : ''}`} />
        {train.isPending ? 'Retraining…' : 'Retrain model'}
      </Button>
    </div>

    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <ShieldAlert className="mr-2 inline h-5 w-5" />
      <b>Required limitation:</b> This model is trained and evaluated using synthetic demonstration data. Predictions are not calibrated real-world failure probabilities and require real-world validation before operational deployment.
    </div>

    {train.isError && <ErrorState error={train.error} />}
    {query.isError ? <ErrorState error={query.error} /> : !query.data ? <Skeleton className="h-[720px]" /> : <Evaluation metrics={query.data} />}
  </div>
}

function Evaluation({ metrics }: { metrics: Metrics }) {
  const model = metrics.random_forest
  const baseline = metrics.threshold_baseline
  const [[trueNegative, falsePositive], [falseNegative, truePositive]] = model.confusion_matrix
  const maxImportance = Math.max(...metrics.permutation_importance_held_out.map(item => Math.abs(item.importance)), 0.001)

  return <>
    <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]" aria-labelledby="overview-title">
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700"><BrainCircuit className="h-6 w-6" /></div>
          <div>
            <h2 id="overview-title" className="text-lg font-bold">What this model predicts</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">The classifier estimates whether a synthetic transformer fault event appears in the next <b>24 hours</b> after each observation. That horizon gives operators time to review loading, temperature, recent fault history, and weather context before a possible interruption.</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Warnings support preventive maintenance prioritization; they do not diagnose a cause, authorize switching, or replace qualified field inspection.</p>
          </div>
        </div>
      </Card>
      <Card><CardHeader title="Evaluation lineage" subtitle="Values read from the persisted model artifact" /><div className="grid gap-3 p-4 sm:grid-cols-2"><Info icon={Activity} label="Model" value={humanize(metrics.model_type)} /><Info icon={Database} label="Version" value={metrics.model_version} /><Info icon={Database} label="Generator" value={metrics.generator_version} /><Info icon={Target} label="Data source" value={humanize(metrics.data_source)} /></div></Card>
    </section>

    <section aria-labelledby="performance-title">
      <div className="mb-3"><h2 id="performance-title" className="text-lg font-bold">Held-out performance</h2><p className="text-sm text-slate-500">Later chronological test data is separated from training by a 24-hour gap.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Precision" value={model.precision} help={metricHelp.precision} />
        <Metric label="Recall" value={model.recall} help={metricHelp.recall} />
        <Metric label="F1 score" value={model.f1} help={metricHelp.f1} />
        <Metric label="PR-AUC" value={model.pr_auc} help={metricHelp.pr_auc} />
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader title="Model vs threshold baseline" subtitle="Higher is better; labels and table prevent color-only interpretation" /><div className="p-5"><div className="mb-4 flex flex-wrap gap-4 text-xs"><Legend color="bg-blue-600" label="Random Forest" /><Legend color="bg-slate-400" label="Threshold baseline" /></div><div className="space-y-4">{(['precision', 'recall', 'f1', 'pr_auc'] as const).map(key => <ComparisonRow key={key} label={key === 'pr_auc' ? 'PR-AUC' : humanize(key)} model={model[key]} baseline={baseline[key]} />)}</div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><caption className="sr-only">Exact model and baseline metrics</caption><thead className="text-slate-500"><tr><th className="py-2">Metric</th><th>Random Forest</th><th>Baseline</th><th>Difference</th></tr></thead><tbody className="divide-y divide-slate-100">{(['precision', 'recall', 'f1', 'pr_auc'] as const).map(key => <tr key={key}><th className="py-2 font-semibold">{key === 'pr_auc' ? 'PR-AUC' : humanize(key)}</th><td>{percent(model[key], 2)}</td><td>{percent(baseline[key], 2)}</td><td className="font-semibold text-blue-700">+{((model[key] - baseline[key]) * 100).toFixed(2)} pp</td></tr>)}</tbody></table></div></div></Card>
      <Card><CardHeader title="Confusion matrix" subtitle="Random Forest predictions on the held-out test block" /><div className="p-5"><div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-center text-sm"><div /><div className="font-semibold text-slate-600">Predicted no fault</div><div className="font-semibold text-slate-600">Predicted fault</div><div className="flex items-center justify-end pr-2 text-right font-semibold text-slate-600">Actual no fault</div><MatrixCell value={trueNegative} label="True negatives" tone="slate" /><MatrixCell value={falsePositive} label="False positives" tone="amber" /><div className="flex items-center justify-end pr-2 text-right font-semibold text-slate-600">Actual fault</div><MatrixCell value={falseNegative} label="False negatives" tone="red" /><MatrixCell value={truePositive} label="True positives" tone="blue" /></div><div className="mt-5 space-y-2 text-sm text-slate-600"><p><b>False positives ({falsePositive.toLocaleString()}):</b> preventive reviews that would not correspond to a synthetic future fault.</p><p><b>False negatives ({falseNegative.toLocaleString()}):</b> synthetic future faults the model did not flag; these matter because missed risk can delay intervention.</p></div></div></Card>
    </section>

    <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <Card><CardHeader title="Evaluation population" subtitle="No evaluation date is shown because none is recorded in the artifact" /><div className="grid gap-3 p-5 sm:grid-cols-2"><Population label="Training rows" value={metrics.split.train_rows.toLocaleString()} detail={`Positive class ${percent(metrics.class_balance.train_positive_rate, 1)}`} /><Population label="Testing rows" value={metrics.split.test_rows.toLocaleString()} detail={`Positive class ${percent(metrics.class_balance.test_positive_rate, 1)}`} /></div><div className="border-t border-slate-100 p-5 text-sm text-slate-600"><p><b>Split:</b> {humanize(metrics.split.strategy)}</p><p className="mt-2">The test block occurs later than training, with a 24-hour gap to reduce leakage from the future-fault label window.</p><p className="mt-2 text-xs text-slate-500">{metrics.evaluation_note}</p></div></Card>
      <Card><CardHeader title="Held-out permutation importance" subtitle="Change in average precision after shuffling each feature; negative values can reflect sampling noise" /><div className="space-y-3 p-5">{metrics.permutation_importance_held_out.map(item => <div key={item.feature} className="grid grid-cols-[minmax(130px,1fr)_2fr_72px] items-center gap-3" title={`${humanize(item.feature)}: ${item.importance.toFixed(6)}`}><span className="truncate text-xs font-semibold text-slate-700">{humanize(item.feature)}</span><div className="relative h-3 rounded-full bg-slate-100"><div className={`h-3 rounded-full ${item.importance < 0 ? 'bg-slate-400' : 'bg-blue-600'}`} style={{ width: `${Math.max(2, Math.abs(item.importance) / maxImportance * 100)}%` }} /></div><span className="text-right font-mono text-[11px] text-slate-500">{item.importance.toFixed(6)}</span></div>)}</div></Card>
    </section>

    <Card><CardHeader title="Understanding Our AI Model" subtitle="Only inputs in the trained artifact are listed" /><div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{metrics.feature_order.map(feature => <article key={feature} className="rounded-xl border border-slate-200 p-4"><Badge tone="blue">{humanize(feature)}</Badge><p className="mt-3 text-sm leading-5 text-slate-600">{featureDescriptions[feature] ?? 'Input recorded in the model feature contract.'}</p></article>)}</div></Card>

    <Card><CardHeader title="How to interpret score thresholds" /><div className="grid gap-4 p-5 md:grid-cols-3"><Explain title="Lower threshold" text="Usually catches more positive cases, increasing recall, but can produce more false positives and operator review work." /><Explain title="Higher threshold" text="Usually reduces false alerts and raises precision, but can miss more positive cases and lower recall." /><Explain title="Operational use" text="Choose a threshold only after real-world calibration, cost analysis, validation, and qualified safety review. The current synthetic evaluation is not sufficient for deployment." /></div></Card>
  </>
}

function Metric({ label, value, help }: { label: string; value: number; help: string }) {
  return <Card className="p-5"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{percent(value, 1)}</p><div className="mt-3 h-1.5 rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, value * 100)}%` }} /></div><p className="mt-3 text-xs leading-5 text-slate-500">{help}</p></Card>
}

function ComparisonRow({ label, model, baseline }: { label: string; model: number; baseline: number }) {
  return <div><div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-slate-700">{label}</span><span className="text-slate-500">{percent(model, 1)} vs {percent(baseline, 1)}</span></div><div className="space-y-1"><div className="h-3 rounded-r bg-blue-600" style={{ width: `${model * 100}%` }} title={`Random Forest ${percent(model, 2)}`} /><div className="h-3 rounded-r bg-slate-400" style={{ width: `${baseline * 100}%` }} title={`Threshold baseline ${percent(baseline, 2)}`} /></div></div>
}

function MatrixCell({ value, label, tone }: { value: number; label: string; tone: 'slate' | 'amber' | 'red' | 'blue' }) {
  const tones = { slate: 'bg-slate-100 text-slate-800', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-900', blue: 'bg-blue-100 text-blue-900' }
  return <div className={`rounded-xl p-4 ${tones[tone]}`}><p className="text-2xl font-bold">{value.toLocaleString()}</p><p className="mt-1 text-xs font-semibold">{label}</p></div>
}

function Legend({ color, label }: { color: string; label: string }) { return <span className="inline-flex items-center gap-2 text-slate-600"><i className={`h-3 w-3 rounded-sm ${color}`} aria-hidden="true" />{label}</span> }
function Population({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div> }
function Explain({ title, text }: { title: string; text: string }) { return <div className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold text-slate-800">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></div> }
function Info({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-4"><Icon className="h-5 w-5 text-blue-600" /><p className="mt-3 text-[10px] uppercase text-slate-400">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div> }
function percent(value: number, digits: number) { return `${(value * 100).toFixed(digits)}%` }
