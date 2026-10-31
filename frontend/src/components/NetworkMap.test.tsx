import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { NetworkMapView } from '../components/NetworkMap'
import type { NetworkMap, MapFeature } from '../types'

const baseFeature: MapFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [75.5, 31.0] },
  properties: {
    transformer_id: 'T-101',
    transformer_name: 'Demo Transformer T-101',
    village: 'Demo Village A',
    feeder_id: 'F-01',
    feeder_name: 'Demo Feeder 1',
    rated_capacity_kva: 250,
    current_utilization_pct: 45,
    health_index: 85,
    fault_risk_score: 0.2,
    risk_category: 'low',
    outage_status: false,
    last_reading_timestamp: '2026-10-31T00:00:00Z',
    data_source: 'synthetic',
  },
}

const polygonFeature: MapFeature = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[75.4, 30.9], [75.6, 30.9], [75.6, 31.1], [75.4, 31.1], [75.4, 30.9]]] },
  properties: {
    feeder_id: 'F-01',
    topology: 'simulated_service_area',
    verified_real_world: false,
    transformer_count: 4,
  },
}

const mockData: NetworkMap = {
  transformers: { type: 'FeatureCollection', features: [baseFeature] },
  feeder_areas: { type: 'FeatureCollection', features: [polygonFeature] },
  geometry_note: 'Schematic feeder service-area polygons',
  data_source: 'synthetic',
  bounds: [[75.4, 30.9], [75.6, 31.1]],
}

function renderMap(data: NetworkMap = mockData) {
  return render(<NetworkMapView data={data} height={430} />)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NetworkMapView', () => {
  it('renders transformer markers', async () => {
    const { container } = renderMap()
    await waitFor(() => expect(container.querySelector('.leaflet-marker-icon')).toBeTruthy())
  })

  it('renders feeder areas as Polygon features', async () => {
    const { container } = renderMap()
    // Polygon geometry is present in the data — verify via the properties rendered in tooltips/popups
    await waitFor(() => expect(container.querySelector('path.leaflet-interactive')).toBeTruthy())
  })

  it('opens the drawer panel when a marker is clicked', async () => {
    const { container } = renderMap()
    const marker = await waitFor(() => container.querySelector('.leaflet-marker-icon'))
    fireEvent.click(marker as Element)
    await waitFor(() => expect(screen.getByText('Open transformer details')).toBeTruthy())
  })

  it('closes the drawer panel when the close button is clicked', async () => {
    const { container } = renderMap()
    const marker = await waitFor(() => container.querySelector('.leaflet-marker-icon'))
    fireEvent.click(marker as Element)
    await waitFor(() => expect(screen.getByText('Open transformer details')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Close details/i }))
    await waitFor(() => expect(screen.queryByText('Open transformer details')).toBeNull())
  })

  it('displays the legend with health/warning/high outage indicators', () => {
    renderMap()
    expect(screen.getByText('Healthy')).toBeTruthy()
    expect(screen.getByText('Warning')).toBeTruthy()
    expect(screen.getByText('High/Outage')).toBeTruthy()
  })
})
