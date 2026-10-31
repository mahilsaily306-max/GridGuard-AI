import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, PhoneCall, Radio, Save } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { saveDraft } from '../offline'
import { Button, Card, Input, Select, Textarea } from '../components/ui'
import type { Complaint, Transformer } from '../types'

const copy = {
  en: { title: 'Village Power Helpline', intro: 'Tell us about the electrical issue. This is a simulated demonstration service.', submit: 'Report Issue' },
  hi: { title: 'गाँव बिजली सहायता', intro: 'बिजली की समस्या बताएं। यह केवल एक सिम्युलेटेड प्रदर्शन सेवा है।', submit: 'समस्या दर्ज करें' },
  pa: { title: 'ਪਿੰਡ ਬਿਜਲੀ ਸਹਾਇਤਾ', intro: 'ਬਿਜਲੀ ਦੀ ਸਮੱਸਿਆ ਬਾਰੇ ਦੱਸੋ। ਇਹ ਸਿਰਫ਼ ਇੱਕ ਸਿਮੂਲੇਟਡ ਡੈਮੋ ਸੇਵਾ ਹੈ।', submit: 'ਸਮੱਸਿਆ ਦਰਜ ਕਰੋ' },
}

const steps = [
  { key: 'location', label: 'Location & transformer' },
  { key: 'issue', label: 'Issue type & severity' },
  { key: 'details', label: 'Description & hazards' },
  { key: 'review', label: 'Review & submit' },
] as const

type StepKey = (typeof steps)[number]['key']

type HelplineForm = {
  transformer_id: string
  village_name: string
  category: string
  severity: string
  duration_minutes: number
  landmark: string
  details: string
  caller_id: string
  hazard_flags: string[]
  language: 'en' | 'hi' | 'pa'
}

const initialForm: HelplineForm = {
  transformer_id: 'T-101',
  village_name: 'Demo Village A',
  category: 'power_outage',
  severity: 'high',
  duration_minutes: 10,
  landmark: '',
  details: '',
  caller_id: 'demo-villager',
  hazard_flags: [],
  language: 'pa',
}

export function HelplinePage() {
  const navigate = useNavigate()
  const transformers = useQuery({ queryKey: ['transformers'], queryFn: () => api<Transformer[]>('/api/transformers') })
  const [language, setLanguage] = useState<'en' | 'hi' | 'pa'>('pa')
  const [step, setStep] = useState<StepKey>('location')
  const [savedOffline, setSavedOffline] = useState(false)
  const [form, setForm] = useState<HelplineForm>(initialForm)

  const submit = useMutation({
    mutationFn: () => api<Complaint>('/api/complaints', { method: 'POST', body: JSON.stringify({ ...form, language }) }),
    onSuccess: result => navigate(`/track/${result.reference}`),
    onError: async () => { await saveDraft('complaint-drafts', { ...form, language }); setSavedOffline(true) },
  })

  const selectTransformer = (id: string) => {
    const item = transformers.data?.find(asset => asset.id === id)
    setForm({ ...form, transformer_id: id, village_name: item?.village_name ?? form.village_name })
  }

  const goBack = () => {
    if (step === 'location') {
      navigate(-1)
      return
    }
    const index = steps.findIndex(item => item.key === step)
    setStep(steps[index - 1].key)
  }

  const goNext = () => {
    const index = steps.findIndex(item => item.key === step)
    if (index < steps.length - 1) setStep(steps[index + 1].key)
  }

  const isLast = step === 'review'
  const categoryLabel = { power_outage: 'Power outage', low_voltage: 'Low voltage', flickering: 'Flickering', transformer_noise: 'Transformer noise', sparking_fire: 'Sparking or fire', fallen_wires: 'Fallen wires', other: 'Other electrical issue' }[form.category] ?? form.category

  return <div className="min-h-screen bg-gradient-to-b from-navy-950 to-navy-900 px-4 py-8 text-white"><div className="mx-auto max-w-xl">
    <div className="text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/20"><PhoneCall className="h-8 w-8" /></div>
      <h1 className="mt-4 text-2xl font-bold">{copy[language].title}</h1>
      <p className="mt-2 text-sm text-slate-300">{copy[language].intro}</p>
      <div className="mt-4 flex justify-center gap-2">{(['pa', 'hi', 'en'] as const).map(value => <button key={value} onClick={() => setLanguage(value)} className={`rounded-full px-4 py-2 text-xs font-semibold ${language === value ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-300'}`}>{value === 'pa' ? 'ਪੰਜਾਬੀ' : value === 'hi' ? 'हिन्दी' : 'English'}</button>)}</div>
    </div>

    <div className="mt-2 flex gap-2 text-xs font-semibold text-slate-400">{steps.map((item, index) => <span key={item.key} className={`flex items-center gap-1 ${step === item.key ? 'text-blue-400' : 'text-slate-600'}`}>{index > 0 && <ArrowLeft className="h-3 w-3" />}{item.label}</span>)}</div>

    <Card className="mt-6 text-slate-900"><div className="space-y-4 p-5">
      <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800"><Radio className="mr-2 inline h-4 w-4" />No real toll-free number or telephony gateway is connected. This form simulates the call flow.</div>

      {step === 'location' && <>
        <label htmlFor="helpline-transformer" className="block text-xs font-semibold">Transformer / village</label>
        <Select id="helpline-transformer" className="mt-2" value={form.transformer_id} onChange={event => selectTransformer(event.target.value)}>
          {transformers.data?.map(item => <option key={item.id} value={item.id}>{item.id} — {item.village_name}</option>)}
        </Select>
      </>}

      {step === 'issue' && <>
        <label htmlFor="helpline-issue" className="block text-xs font-semibold">Issue</label>
        <Select id="helpline-issue" className="mt-2" value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>
          <option value="power_outage">Power outage</option>
          <option value="low_voltage">Low voltage</option>
          <option value="flickering">Flickering</option>
          <option value="transformer_noise">Transformer noise</option>
          <option value="sparking_fire">Sparking or fire</option>
          <option value="fallen_wires">Fallen wires</option>
          <option value="other">Other electrical issue</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <label htmlFor="helpline-severity" className="block text-xs font-semibold">Severity</label>
          <Select id="helpline-severity" className="mt-2" value={form.severity} onChange={event => setForm({ ...form, severity: event.target.value })}>
            <option>low</option>
            <option>medium</option>
            <option>high</option>
            <option>emergency</option>
          </Select>
          <label htmlFor="helpline-duration" className="block text-xs font-semibold">Duration (minutes)</label>
          <Input id="helpline-duration" className="mt-2" type="number" min={0} value={form.duration_minutes} onChange={event => setForm({ ...form, duration_minutes: Number(event.target.value) })} />
        </div>
      </>}

      {step === 'details' && <>
        <label htmlFor="helpline-landmark" className="block text-xs font-semibold">Landmark</label>
        <Input id="helpline-landmark" className="mt-2" value={form.landmark} onChange={event => setForm({ ...form, landmark: event.target.value })} placeholder="Near school or health centre" />
        <label htmlFor="helpline-details" className="block text-xs font-semibold">Details</label>
        <Textarea id="helpline-details" className="mt-2" rows={3} value={form.details} onChange={event => setForm({ ...form, details: event.target.value })} placeholder="What happened? How many homes are affected?" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.hazard_flags.includes('visible_sparking')} onChange={event => setForm({ ...form, hazard_flags: event.target.checked ? ['visible_sparking'] : [] })} />
          <span>Visible sparking, fire, or fallen wire hazard</span>
        </label>
      </>}

      {step === 'review' && <>
        <div className="grid grid-cols-[120px_1fr] gap-2 text-sm mb-4">
          <div className="text-slate-500">Transformer</div><div>{form.transformer_id} — {form.village_name}</div>
          <div className="text-slate-500">Issue</div><div>{categoryLabel}</div>
          <div className="text-slate-500">Severity</div><div className="text-capitalize">{form.severity}</div>
          <div className="text-slate-500">Duration</div><div>{form.duration_minutes} minutes</div>
          <div className="text-slate-500">Landmark</div><div>{form.landmark || '—'}</div>
          <div className="text-slate-500">Details</div><div>{form.details || '—'}</div>
          <div className="text-slate-500">Hazard flag</div><div>{form.hazard_flags.includes('visible_sparking') ? 'Visible sparking, fire, or fallen wire hazard' : 'None'}</div>
        </div>
      </>}

      <div className="flex items-center justify-between pt-2 border-t border-slate-200/30">
        {step !== 'location' && <Button type="button" variant="secondary" onClick={goBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>}
        {step === 'location' && <Button type="button" variant="secondary" onClick={goBack}><ArrowLeft className="mr-2 h-4 w-4" />Back to previous page</Button>}
        {step !== 'review' ? <Button type="button" onClick={goNext} disabled={!transformers.data}><ArrowLeft /> Next<ArrowLeft className="-mr-1 rotate-180" /></Button> : <Button className="w-full" onClick={() => submit.mutate()} disabled={submit.isPending}><PhoneCall className="h-4 w-4" />{submit.isPending ? 'Sending…' : copy[language].submit}</Button>}
      </div>

      {savedOffline && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><Save className="mr-2 inline h-4 w-4" />Network submission failed. Draft saved locally as <b>unsynced</b>; it is not a confirmed complaint.</div>}
      {submit.isSuccess && <div className="text-emerald-700"><CheckCircle2 className="mr-2 inline" />Complaint received</div>}
    </div></Card></div></div>
}
