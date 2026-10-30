import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { X, Search, AlertTriangle, Map, Wrench, ClipboardList, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useNavigate } from 'react-router-dom'
import type { Transformer, Complaint, WorkOrder, AlertRecord } from '../types'

interface SearchResult {
  kind: 'transformer' | 'complaint' | 'workorder' | 'alert'
  id: string | number
  label: string
  subtitle: string
  path: string
}

const ICONS: Record<SearchResult['kind'], React.ElementType> = {
  transformer: Map,
  complaint: ClipboardList,
  workorder: Wrench,
  alert: AlertTriangle,
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  const fetchResults = useCallback(async () => {
    if (!open || !user) return
    setLoading(true)
    const fetched: SearchResult[] = []
    const push = <T,>(list: T[], kind: SearchResult['kind'], labelOf: (item: T) => string, subtitleOf: (item: T) => string, pathOf: (item: T) => string) => {
      for (const item of list) {
        fetched.push({ kind, id: String((item as any).id ?? (item as any).reference), label: labelOf(item), subtitle: subtitleOf(item), path: pathOf(item) })
      }
    }
    try {
      const transformers = await api<Transformer[]>('/api/transformers')
      push(transformers ?? [], 'transformer', (t) => t.id, (t) => `${t.village_name} · ${t.status}`, (t) => `/transformers/${t.id}`)
    } catch {}
    try {
      const complaints = await api<Complaint[]>('/api/complaints')
      push(complaints ?? [], 'complaint', (c) => c.reference, (c) => `${c.village_name} · ${c.status}`, (c) => `/track/${c.reference}`)
    } catch {}
    try {
      const workOrders = await api<WorkOrder[]>('/api/work-orders')
      push(workOrders ?? [], 'workorder', (w) => w.reference, (w) => `${w.transformer_id ?? '—'} · ${w.status}`, (w) => `/work-orders/${w.id}`)
    } catch {}
    try {
      const alerts = await api<AlertRecord[]>('/api/alerts?limit=50')
      push(alerts ?? [], 'alert', (a) => a.transformer_id ?? a.feeder_id ?? `alert-${a.id}`, (a) => `${a.severity} · ${a.category}`, () => `/alerts`)
    } catch {}
    setResults(fetched)
    setLoading(false)
  }, [open, user])

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return results.slice(0, 12)
    return results.filter((r) => r.label.toUpperCase().includes(q) || r.subtitle.toUpperCase().includes(q)).slice(0, 12)
  }, [query, results])

  const select = useCallback((path: string) => {
    onClose()
    navigate(path)
  }, [onClose, navigate])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-white/20 m-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Command palette</h2>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 text-slate-500" aria-label="Close command palette">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transformers, complaints, work orders, alerts…"
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-3 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {loading ? (
            <p className="mt-4 text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="mt-4 text-slate-500">{query ? 'No results found' : 'Start typing to search'}</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
              {filtered.map((r) => {
                const Icon = ICONS[r.kind]
                return (
                  <li key={`${r.kind}-${r.id}`}>
                    <button
                      onClick={() => select(r.path)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition focus:outline-none"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-900">{r.label}</div>
                        <div className="text-xs text-slate-500">{r.subtitle}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 ml-auto" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 text-right">
          <span className="text-xs text-slate-400">Ctrl+K to open · Esc to close</span>
        </div>
      </div>
    </div>
  )
}
