import L from 'leaflet'
import { MapContainer, Marker, Polygon, Popup, TileLayer, Tooltip } from 'react-leaflet'
import { useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { MapFeature, NetworkMap } from '../types'
import { Button, Badge } from './ui'

const colors: Record<string, string> = { low: '#16a34a', warning: '#f59e0b', high: '#ef4444' }
const feederColors = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#6366f1']

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
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const center = useMemo<[number, number]>(() => {
    if (!points.length) return [31.326, 75.576]
    const lat = points.reduce((sum, feature) => sum + Number((feature.geometry.coordinates as number[])[1]), 0) / points.length
    const lon = points.reduce((sum, feature) => sum + Number((feature.geometry.coordinates as number[])[0]), 0) / points.length
    return [lat, lon]
  }, [points])

  const bounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (data.bounds) return data.bounds
    if (!points.length) return null
    const lats = points.map(f => Number((f.geometry.coordinates as number[])[1]))
    const lons = points.map(f => Number((f.geometry.coordinates as number[])[0]))
    const pad = 0.02
    return [[Math.min(...lats) - pad, Math.min(...lons) - pad], [Math.max(...lats) + pad, Math.max(...lons) + pad]]
  }, [points, data.bounds])

  const selectedFeature = points.find(f => String(f.properties.transformer_id) === selectedId)

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200" style={{ height }} role="region" aria-label="Synthetic transformer network map">
      <MapContainer
        center={center}
        zoom={11}
        bounds={bounds ?? undefined}
        scrollWheelZoom
        className="h-full w-full"
        aria-label="Synthetic transformer network map"
      >
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {data.feeder_areas.features.map((feature, index) => {
          const ring = (feature.geometry.coordinates as unknown as number[][][])[0]
          const positions = ring.map(([lon, lat]) => [lat, lon] as [number, number])
          const fid = String(feature.properties.feeder_id)
          const color = feederColors[index % feederColors.length]
          const count = Number(feature.properties.transformer_count ?? 0)
          return (
            <Polygon
              key={`${fid}-${index}`}
              positions={positions}
              pathOptions={{
                color,
                weight: 2,
                opacity: 0.5,
                fillOpacity: 0.12,
                fill: true,
              }}
            >
              <Tooltip sticky direction="top" offset={[0, -10]}>{fid} · service area · {count} transformers</Tooltip>
            </Polygon>
          )
        })}
        {points.map((feature) => {
          const [lon, lat] = feature.geometry.coordinates as number[]
          const id = String(feature.properties.transformer_id)
          const risk = String(feature.properties.risk_category)
          const isSelected = id === selectedId
          return (
            <Marker
              key={id}
              position={[lat, lon]}
              icon={iconFor(feature)}
              eventHandlers={{
                click: () => {
                  setSelectedId(isSelected ? null : id)
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -14]}>{id} · {String(feature.properties.village)}</Tooltip>
              <Popup>
                <div className="min-w-52 space-y-2 font-sans">
                  <div className="flex items-center justify-between"><strong>{id}</strong><Badge tone={risk === 'high' ? 'red' : risk === 'warning' ? 'amber' : 'green'}>{risk}</Badge></div>
                  <p className="m-0 text-xs text-slate-600">{String(feature.properties.village)} · {String(feature.properties.feeder_name)}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs"><span>Load <b>{Number(feature.properties.current_utilization_pct).toFixed(1)}%</b></span><span>Health <b>{Number(feature.properties.health_index).toFixed(0)}</b></span><span>Risk <b>{(Number(feature.properties.fault_risk_score) * 100).toFixed(0)}%</b></span><span>{Number(feature.properties.rated_capacity_kva)} kVA</span></div>
                  <Button className="w-full" onClick={() => setSelectedId(isSelected ? null : id)}>
                    {isSelected ? 'Close details' : 'Open details'}
                  </Button>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-200 bg-white/95 p-2 text-[11px] shadow-lg backdrop-blur">
        <div className="flex gap-3"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" />Healthy</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Warning</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />High/Outage</span></div>
        <p className="mt-1 text-slate-500">Synthetic demonstration topology</p>
      </div>
      {selectedFeature && selectedId && (
        <DrawerPanel
          id={selectedId}
          feature={selectedFeature}
          onClose={() => setSelectedId(null)}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}

function DrawerPanel({ id, feature, onClose, onSelect }: { id: string; feature: MapFeature; onClose: () => void; onSelect?: (id: string) => void }) {
  const risk = String(feature.properties.risk_category)
  const outage = Boolean(feature.properties.outage_status)
  return (
    <div className="absolute inset-0 z-[600] flex items-end" aria-hidden="true">
      <div className="w-full max-w-md h-[45%] rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-300 animate-in slide-in-from-bottom">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100" aria-label="Close transformer details">
            <span className="block w-5 h-5" dangerouslySetInnerHTML={{ __html: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>' }} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{id}</span>
            {outage && <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">Outage</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <div className="bg-slate-50 p-2 rounded"><span className="text-xs text-slate-500 block">Village</span>{String(feature.properties.village)}</div>
          <div className="bg-slate-50 p-2 rounded"><span className="text-xs text-slate-500 block">Feeder</span>{String(feature.properties.feeder_name)} ({String(feature.properties.feeder_id)})</div>
          <div className="bg-slate-50 p-2 rounded"><span className="text-xs text-slate-500 block">Capacity</span>{Number(feature.properties.rated_capacity_kva)} kVA</div>
          <div className="bg-slate-50 p-2 rounded"><span className="text-xs text-slate-500 block">Load</span>{Number(feature.properties.current_utilization_pct).toFixed(1)}%</div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500">Risk score</span>
          <Badge tone={risk === 'high' ? 'red' : risk === 'warning' ? 'amber' : 'green'}>{risk.charAt(0).toUpperCase() + risk.slice(1)}</Badge>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500">Health index</span>
          <span className="text-xs font-mono">{Number(feature.properties.health_index).toFixed(0)}</span>
        </div>
        <p className="text-xs text-slate-500 mb-3">Last reading: {String(feature.properties.last_reading_timestamp ?? '—')}</p>
        <Button className="w-full" onClick={() => onSelect?.(id)}>Open transformer details</Button>
      </div>
    </div>
  )
}
