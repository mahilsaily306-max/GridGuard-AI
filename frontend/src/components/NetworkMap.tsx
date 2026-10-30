import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from 'react-leaflet'
import { useMemo } from 'react'
import 'leaflet/dist/leaflet.css'
import type { MapFeature, NetworkMap } from '../types'
import { Button, Badge } from './ui'

const colors: Record<string, string> = { low: '#16a34a', warning: '#f59e0b', high: '#ef4444' }

function iconFor(feature: MapFeature) {
  const risk = String(feature.properties.risk_category ?? 'low')
  const outage = Boolean(feature.properties.outage_status)
  const color = outage ? '#dc2626' : colors[risk] ?? colors.low
  return L.divIcon({
    className: '',
    html: `<div class="gg-map-marker" style="--marker:${color}"><span>${outage ? '!' : '⚡'}</span></div>`,
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14],
  })
}

export function NetworkMapView({ data, height = 430, onSelect }: { data: NetworkMap; height?: number; onSelect?: (id: string) => void }) {
  const points = data.transformers.features
  const center = useMemo<[number, number]>(() => {
    if (!points.length) return [31.326, 75.576]
    const lat = points.reduce((sum, feature) => sum + Number((feature.geometry.coordinates as number[])[1]), 0) / points.length
    const lon = points.reduce((sum, feature) => sum + Number((feature.geometry.coordinates as number[])[0]), 0) / points.length
    return [lat, lon]
  }, [points])
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200" style={{ height }}>
      <MapContainer center={center} zoom={11} scrollWheelZoom className="h-full w-full" aria-label="Synthetic transformer network map">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {data.feeder_lines.features.map((feature, index) => {
          const positions = (feature.geometry.coordinates as number[][]).map(([lon, lat]) => [lat, lon] as [number, number])
          return <Polyline key={`${feature.properties.feeder_id}-${index}`} positions={positions} pathOptions={{ color: ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#6366f1'][index % 6], weight: 3, opacity: .8 }}><Tooltip sticky>{String(feature.properties.feeder_id)} · simulated feeder path</Tooltip></Polyline>
        })}
        {points.map((feature) => {
          const [lon, lat] = feature.geometry.coordinates as number[]
          const id = String(feature.properties.transformer_id)
          const risk = String(feature.properties.risk_category)
          return <Marker key={id} position={[lat, lon]} icon={iconFor(feature)} eventHandlers={{ click: () => onSelect?.(id) }}>
            <Tooltip direction="top" offset={[0, -14]}>{id} · {String(feature.properties.village)}</Tooltip>
            <Popup>
              <div className="min-w-52 space-y-2 font-sans">
                <div className="flex items-center justify-between"><strong>{id}</strong><Badge tone={risk === 'high' ? 'red' : risk === 'warning' ? 'amber' : 'green'}>{risk}</Badge></div>
                <p className="m-0 text-xs text-slate-600">{String(feature.properties.village)} · {String(feature.properties.feeder_name)}</p>
                <div className="grid grid-cols-2 gap-2 text-xs"><span>Load <b>{Number(feature.properties.current_utilization_pct).toFixed(1)}%</b></span><span>Health <b>{Number(feature.properties.health_index).toFixed(0)}</b></span><span>Risk <b>{(Number(feature.properties.fault_risk_score) * 100).toFixed(0)}%</b></span><span>{Number(feature.properties.rated_capacity_kva)} kVA</span></div>
                <Button className="w-full" onClick={() => onSelect?.(id)}>Open details</Button>
              </div>
            </Popup>
          </Marker>
        })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-200 bg-white/95 p-2 text-[11px] shadow-lg backdrop-blur">
        <div className="flex gap-3"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" />Healthy</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Warning</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />High/Outage</span></div>
        <p className="mt-1 text-slate-500">Synthetic demonstration topology</p>
      </div>
    </div>
  )
}
