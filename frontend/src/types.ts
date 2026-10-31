export type UserRole = 'administrator' | 'operator' | 'lineman' | 'supervisor' | 'public'

export interface User {
  id: number
  username: string
  display_name: string
  role: UserRole
  language: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in_seconds: number
  user: User
}

export interface Overview {
  total_transformers: number
  total_feeders: number
  risk_counts: { healthy: number; warning: number; high_risk: number }
  risk_percentages: Record<string, number>
  active_incidents: number
  estimated_affected_households: number
  average_load_utilization: { value: number; unit: string }
  utilization_change_pct_points: number
  last_data_refresh: string
  data_source: string
}

export interface Prediction {
  risk_score: number
  risk_level: 'low' | 'warning' | 'high'
  generated_at?: string
  top_factors?: string[]
  model_version?: string
}

export interface Reading {
  observed_at: string
  load_pct: number
  oil_temp_c: number
  ambient_temp_c: number
  apparent_load_kva?: number
  voltage_v?: number
  current_a?: number
  phase_imbalance_pct?: number
  humidity_pct?: number
  quality_flag?: string
  provenance?: string
}

export interface Transformer {
  id: string
  name?: string
  feeder_id: string
  village_name: string
  latitude: number
  longitude: number
  capacity_kva: number
  age_years: number
  installation_year?: number
  status: string
  latest_prediction: Prediction
  latest_reading: Reading
  health?: Health
  readings?: Reading[]
  fault_history?: unknown[]
  telemetry_status?: { stale: boolean; age_hours: number; quality_flag: string }
}

export interface Health {
  overall_health_index: number
  condition: string
  dimensions: Record<string, { health_score: number; stress_score: number; weight: number }>
  missing_data_flags: string[]
  health_scoring_version: string
}

export interface MapFeature {
  type: 'Feature'
  geometry: { type: 'Point' | 'Polygon'; coordinates: number[] | number[][][] }
  properties: Record<string, string | number | boolean | null>
}

export interface NetworkMap {
  transformers: { type: 'FeatureCollection'; features: MapFeature[] }
  feeder_areas: { type: 'FeatureCollection'; features: MapFeature[] }
  geometry_note: string
  data_source: string
  bounds?: [[number, number], [number, number]]
}

export interface AlertRecord {
  id: number
  transformer_id: string | null
  feeder_id: string | null
  category: string
  severity: 'info' | 'warning' | 'critical'
  explanation: string
  created_at: string
  status: string
  occurrence_count: number
}

export interface Complaint {
  id: number
  reference: string
  incident_id: number
  village_name: string
  transformer_id?: string
  category: string
  severity: string
  status: string
  incident_status?: string
  work_order_status?: string
  tracking_steps: { key: string; label: string; complete: boolean }[]
  created_at: string
}

export interface WorkOrder {
  id: number
  reference: string
  incident_id: number
  transformer_id: string | null
  priority: string
  status: string
  lineman_name: string
  supervisor_name: string
  service_zone_name: string
  safety_acknowledged_at: string | null
  hazards: string[]
  stop_work: number
  complaints: Complaint[]
  diagnostics: Diagnostic[]
  repair_report: Record<string, string | number | null> | null
  evidence: Record<string, string | number>[]
  supervisor_decisions: Record<string, string | number | null>[]
  transitions: Record<string, string | number | null>[]
  updated_at?: string
}

export interface Diagnostic {
  id: number
  rank: number
  fault_category: string
  score: number
  supporting_evidence: string[]
  explanation: string
  inspection_status: string
}
