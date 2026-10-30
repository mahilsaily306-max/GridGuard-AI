import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Bell, BookOpen, ClipboardList, FileBarChart, FlaskConical,
  Gauge, History, LayoutDashboard, LogOut, Map, Menu, Search, ShieldCheck, Users, Wrench, X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { GlobalSearch } from './GlobalSearch'
import type { AlertRecord } from '../types'

const links = [
  ['Dashboard', '/', LayoutDashboard], ['Map', '/map', Map], ['Transformers', '/transformers', Activity],
  ['Predictive Alerts', '/alerts', AlertTriangle], ['Complaints', '/complaints', ClipboardList],
  ['Work Orders', '/work-orders', Wrench], ['Simulation Lab', '/simulation', FlaskConical],
  ['Model Evaluation', '/model-evaluation', Gauge], ['Incident Replay', '/replay/999', History],
  ['Reports', '/reports', FileBarChart], ['Knowledge Base', '/knowledge-base', BookOpen],
  ['Users & Roles', '/users', Users], ['Audit Logs', '/audit-logs', ShieldCheck],
] as const

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const alerts = useQuery({ queryKey: ['alerts', 'header'], queryFn: () => api<AlertRecord[]>('/api/alerts?status=open&limit=20'), refetchInterval: 15000 })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k') return
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target as HTMLElement)?.isContentEditable) return
      event.preventDefault()
      setGlobalSearchOpen((prev) => !prev)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = search.trim().toUpperCase()
    if (/^T-\d{3}$/.test(normalized)) navigate(`/transformers/${normalized}`)
    else navigate(`/transformers?q=${encodeURIComponent(search.trim())}`)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="fixed inset-x-0 top-0 z-[1000] flex h-16 items-center border-b border-white/10 bg-navy-950 px-3 text-white lg:pl-[264px]">
        <button className="mr-2 rounded-lg p-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
        <form onSubmit={submitSearch} className="mx-auto flex w-full max-w-xl items-center rounded-xl border border-white/10 bg-white/5 px-3 focus-within:border-blue-400">
          <Search className="h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full bg-transparent px-3 text-sm outline-none placeholder:text-slate-400" placeholder="Search transformer, village or complaint…" />
        </form>
        <div className="ml-3 flex items-center gap-3">
          <button className="relative rounded-lg p-2 hover:bg-white/10" aria-label="Notifications"><Bell className="h-5 w-5" />{alerts.data?.length ? <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold">{Math.min(alerts.data.length, 9)}</span> : null}</button>
          <div className="hidden text-right sm:block"><p className="text-xs font-semibold">{user?.display_name ?? 'Guest'}</p><p className="text-[10px] capitalize text-slate-400">{user?.role ?? 'Public access'}</p></div>
          {user && <button onClick={() => { logout(); navigate('/login') }} className="rounded-lg p-2 hover:bg-white/10" aria-label="Log out"><LogOut className="h-5 w-5" /></button>}
        </div>
      </header>
      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
      <aside className={`fixed inset-y-0 left-0 z-[1100] w-64 bg-gradient-to-b from-navy-950 to-navy-900 text-slate-200 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"><Activity className="h-5 w-5" /></div>
          <div><p className="font-bold tracking-tight">GridGuard AI</p><p className="text-[10px] text-slate-400">Smart Monitoring & Prediction</p></div>
          <button className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <nav className="h-[calc(100vh-4rem)] overflow-y-auto p-3">
          {links.map(([label, path, Icon]) => <NavLink key={path} to={path} onClick={() => setMobileOpen(false)} className={({ isActive }) => `mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-800/30' : 'hover:bg-white/10 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</NavLink>)}
          <div className="my-3 border-t border-white/10" />
          <NavLink to="/helpline" className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/10"><Bell className="h-4 w-4" />Villager Helpline</NavLink>
          <NavLink to="/track" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/10"><Search className="h-4 w-4" />Track Complaint</NavLink>
        </nav>
      </aside>
      <main className="min-h-screen pt-16 lg:pl-64"><Outlet /></main>
    </div>
  )
}
