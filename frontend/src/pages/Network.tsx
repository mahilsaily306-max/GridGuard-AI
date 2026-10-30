import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { NetworkMapView } from '../components/NetworkMap'
import { Badge, Card, CardHeader, ErrorState, Select, Skeleton } from '../components/ui'
import type { NetworkMap } from '../types'

export function NetworkPage() {
  const [feeder, setFeeder] = useState('')
  const [risk, setRisk] = useState('')
  const navigate = useNavigate()
  const query = new URLSearchParams({ ...(feeder ? { feeder_id: feeder } : {}), ...(risk ? { risk_level: risk } : {}) })
  const map = useQuery({ queryKey: ['map', feeder, risk], queryFn: () => api<NetworkMap>(`/api/network/map?${query}`) })
  return <div className="space-y-4 p-4 lg:p-6"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Network intelligence</p><h1 className="text-2xl font-bold">Virtual Transformer Map</h1><p className="text-sm text-slate-500">Fictional demonstration infrastructure; not a verified utility network.</p></div><Card><CardHeader title="Map controls" action={<Badge tone="blue">OpenStreetMap</Badge>} /><div className="grid gap-3 p-4 sm:grid-cols-2"><Select value={feeder} onChange={event => setFeeder(event.target.value)}><option value="">All feeders</option>{Array.from({ length: 6 }, (_, index) => <option key={index} value={`F-${String(index + 1).padStart(2, '0')}`}>Feeder {index + 1}</option>)}</Select><Select value={risk} onChange={event => setRisk(event.target.value)}><option value="">All risk levels</option><option value="low">Healthy</option><option value="warning">Warning</option><option value="high">High risk</option></Select></div></Card>{map.isError ? <ErrorState error={map.error} /> : map.data ? <NetworkMapView data={map.data} height={680} onSelect={id => navigate(`/transformers/${id}`)} /> : <Skeleton className="h-[680px]" />}</div>
}
