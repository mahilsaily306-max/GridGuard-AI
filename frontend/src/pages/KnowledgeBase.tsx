import { useQuery } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, Search, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api, formatDate } from '../api'
import { Badge, Card, CardHeader, EmptyState, ErrorState, Input, Select, Skeleton } from '../components/ui'

type KnowledgeEntry = {
  id: string
  entry_type: 'reference_guidance' | 'verified_repair'
  title: string
  category: string
  simple_explanation: string
  warning_signs: string[]
  possible_causes: string[]
  relevant_measurements: string[]
  safe_inspection_considerations: string[]
  preventive_recommendations: string[]
  source_classification: 'Demo Knowledge / Reference Guidance' | 'Supervisor-Verified Repair Outcome'
  created_at: string
  transformer_id?: string
  work_order_id?: number
  repair_action?: string
}

const categories = [
  'Transformer Fundamentals',
  'Condition Monitoring',
  'Preventive Maintenance',
  'Complaint Handling',
  'Reporting',
  'Work Orders',
  'Incident Response',
]

export function KnowledgeBasePage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const params = new URLSearchParams()
  if (search.trim()) params.set('query', search.trim())
  if (category) params.set('category', category)
  const query = useQuery({
    queryKey: ['knowledge', search, category],
    queryFn: () => api<KnowledgeEntry[]>(`/api/knowledge-base${params.size ? `?${params}` : ''}`),
  })

  const reference = query.data?.filter(item => item.entry_type === 'reference_guidance') ?? []
  const verified = query.data?.filter(item => item.entry_type === 'verified_repair') ?? []

  return <div className="space-y-4 p-4 lg:p-6">
    <div>
      <p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Operational learning</p>
      <h1 className="text-2xl font-bold">Fault Knowledge Base</h1>
      <p className="text-sm text-slate-500">Reference guidance and supervisor-verified field outcomes remain visibly separate.</p>
    </div>

    <div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 md:grid-cols-2" role="note">
      <p><BookOpen className="mr-2 inline h-5 w-5" /><b>Reference guidance</b> supports training and consistent review; it is demonstration content, not a field diagnosis.</p>
      <p><ShieldCheck className="mr-2 inline h-5 w-5" /><b>Verified outcomes</b> appear only after an independent supervisor approves a completed repair workflow.</p>
    </div>

    <Card>
      <CardHeader title="Search knowledge" subtitle="Search titles, symptoms, causes, measurements, or recommendations" />
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_260px]">
        <label><span className="sr-only">Search knowledge</span><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Search knowledge" value={search} onChange={event => setSearch(event.target.value)} /></div></label>
        <label><span className="sr-only">Filter by category</span><Select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</Select></label>
      </div>
    </Card>

    {query.isError ? <ErrorState error={query.error} /> : !query.data ? <Skeleton className="h-[560px]" /> : <>
      <KnowledgeSection
        title="Demo Knowledge / Reference Guidance"
        subtitle="Seeded, general-purpose guidance kept separate from verified repair evidence"
        entries={reference}
        emptyTitle="No reference guidance found"
        emptyDetail="Adjust the search or category filter to view another topic."
      />
      <KnowledgeSection
        title="Supervisor-Verified Repair Outcomes"
        subtitle="Records promoted only after independent approval in the field workflow"
        entries={verified}
        emptyTitle="No verified repair outcomes found"
        emptyDetail="Complete a repair and receive independent supervisor approval to create a verified record."
      />
    </>}
  </div>
}

function KnowledgeSection({ title, subtitle, entries, emptyTitle, emptyDetail }: { title: string; subtitle: string; entries: KnowledgeEntry[]; emptyTitle: string; emptyDetail: string }) {
  return <Card>
    <CardHeader title={title} subtitle={subtitle} />
    {entries.length === 0 ? <EmptyState title={emptyTitle} detail={emptyDetail} /> : <>
      <div className="grid gap-3 p-4 md:grid-cols-2 lg:hidden">
        {entries.map(item => <KnowledgeCard key={item.id} item={item} />)}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Topic</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Details</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{entries.map(item => <tr key={item.id} className="align-top"><td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-500">{item.id}</td><td className="max-w-sm px-4 py-4"><p className="font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.simple_explanation}</p></td><td className="px-4 py-4"><Badge>{item.category}</Badge></td><td className="px-4 py-4"><SourceBadge item={item} /></td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDate(item.created_at)}</td><td className="w-72 px-4 py-4"><KnowledgeDetails item={item} /></td></tr>)}</tbody>
        </table>
      </div>
    </>}
  </Card>
}

function KnowledgeCard({ item }: { item: KnowledgeEntry }) {
  return <article className="rounded-xl border border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.entry_type === 'verified_repair' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{item.entry_type === 'verified_repair' ? <CheckCircle2 className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}</div>
      <SourceBadge item={item} />
    </div>
    <p className="mt-4 font-mono text-[10px] text-slate-400">{item.id}</p>
    <h2 className="mt-1 font-bold">{item.title}</h2>
    <Badge>{item.category}</Badge>
    <p className="mt-3 text-sm leading-6 text-slate-600">{item.simple_explanation}</p>
    <div className="mt-4"><KnowledgeDetails item={item} /></div>
    <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] text-slate-400">Created {formatDate(item.created_at)}{item.transformer_id ? ` · ${item.transformer_id}` : ''}{item.work_order_id ? ` · Work order #${item.work_order_id}` : ''}</p>
  </article>
}

function SourceBadge({ item }: { item: KnowledgeEntry }) {
  return <Badge tone={item.entry_type === 'verified_repair' ? 'green' : 'blue'}>{item.source_classification}</Badge>
}

function KnowledgeDetails({ item }: { item: KnowledgeEntry }) {
  return <details className="group text-xs text-slate-600">
    <summary className="cursor-pointer font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">View guidance details</summary>
    <div className="mt-3 space-y-3">
      <DetailList title="Warning signs" items={item.warning_signs} />
      <DetailList title="Possible causes" items={item.possible_causes} />
      <DetailList title="Relevant measurements" items={item.relevant_measurements} />
      <DetailList title="Safe inspection considerations" items={item.safe_inspection_considerations} />
      <DetailList title="Preventive recommendations" items={item.preventive_recommendations} />
      {item.repair_action && <DetailList title="Verified repair action" items={[item.repair_action]} />}
    </div>
  </details>
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return <div><h3 className="font-bold text-slate-700">{title}</h3><ul className="mt-1 list-disc space-y-1 pl-4">{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></div>
}
