import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export function LoadTemperatureChart({ data }: { data: Array<{ timestamp: string; load_utilization: { value: number }; oil_temperature: { value: number } }> }) {
  const chart = data.map((item) => ({ time: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), load: item.load_utilization.value, temp: item.oil_temperature.value }))
  return <ResponsiveContainer width="100%" height={220}><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" tick={{ fontSize: 10 }} /><YAxis yAxisId="left" tick={{ fontSize: 10 }} /><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} /><Tooltip /><Line yAxisId="left" type="monotone" dataKey="load" name="Load (%)" stroke="#1677ff" strokeWidth={2.5} dot={false} /><Line yAxisId="right" type="monotone" dataKey="temp" name="Oil temperature (°C)" stroke="#f59e0b" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer>
}

export function TrendChart({ data }: { data: Array<{ observed_at: string; load_pct: number; oil_temp_c: number }> }) {
  const chart = [...data].reverse().map((item) => ({ time: new Date(item.observed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }), load: item.load_pct, temp: item.oil_temp_c }))
  return <ResponsiveContainer width="100%" height={280}><AreaChart data={chart}><defs><linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1769ff" stopOpacity={.25}/><stop offset="95%" stopColor="#1769ff" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" minTickGap={40} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Area type="monotone" dataKey="load" name="Load (%)" stroke="#1769ff" fill="url(#loadFill)" strokeWidth={2} /><Line type="monotone" dataKey="temp" name="Oil temp (°C)" stroke="#f59e0b" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer>
}

export function ImportanceChart({ data }: { data: Array<{ feature: string; importance: number }> }) {
  const top = data.slice(0, 8)
  return <ResponsiveContainer width="100%" height={300}><BarChart data={top} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="feature" width={120} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="importance" radius={[0, 6, 6, 0]}>{top.map((_, index) => <Cell key={index} fill={index < 3 ? '#1769ff' : '#60a5fa'} />)}</Bar></BarChart></ResponsiveContainer>
}
