import { Activity, Eye, EyeOff, Pause, Play, ShieldCheck, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Button, Input } from '../components/ui'

const accounts = [
  ['operator', 'Operator@123', 'Control-room operator'],
  ['lineman1', 'Lineman@123', 'Field lineman'],
  ['supervisor', 'Supervisor@123', 'Supervisor'],
  ['admin', 'Admin@123', 'Administrator'],
] as const

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(true)
  const [username, setUsername] = useState('operator')
  const [password, setPassword] = useState('Operator@123')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (user) return <Navigate to="/" replace />

  const toggleVideo = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      void videoRef.current.play()
      setIsPlaying(true)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setPending(true)
    try {
      await login(username, password)
      const destination = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(destination, { replace: true })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed') }
    finally { setPending(false) }
  }
  return <main className="grid min-h-screen bg-navy-950 lg:grid-cols-[1.1fr_.9fr]">
    <section className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
      {/* Smart Grid Motion Background Video (Best Config: WebM + FastStart MP4 + Poster) */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster="/videos/login_bg_poster.jpg"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover mix-blend-screen opacity-70 filter brightness-110 contrast-125"
      >
        <source src="/videos/login_background.webm" type="video/webm" />
        <source src="/videos/login_background.mp4" type="video/mp4" />
      </video>

      {/* Dark gradient & atmospheric glow overlays for optimal contrast and readability */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/95 via-navy-950/50 to-navy-950/80" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(7,27,43,0.85)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-15" />
      <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-blue-500/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-emerald-500/15 blur-3xl" />

      {/* Foreground Content */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30">
          <Activity className="h-6 w-6 text-navy-950" />
        </div>
        <div>
          <p className="text-xl font-bold tracking-tight">GridGuard AI</p>
          <p className="text-xs text-slate-300">Smart Transformer Monitoring &amp; Prediction</p>
        </div>
      </div>

      <div className="relative z-10 max-w-xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-950/40 px-3 py-1 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[11px] font-bold uppercase tracking-[.25em] text-blue-200">Rural distribution intelligence</p>
        </div>
        <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight drop-shadow-sm">
          From early warning to verified restoration.
        </h1>
        <p className="mt-5 max-w-lg text-lg text-slate-200 leading-relaxed drop-shadow-sm">
          One evidence-linked workflow for control-room teams, field linemen, supervisors, and village outage reporting.
        </p>
        <div className="mt-8 grid grid-cols-3 gap-3">
          <Feature icon={Zap} label="ML risk support" />
          <Feature icon={ShieldCheck} label="Verified repairs" />
          <Feature icon={Activity} label="Live workflow" />
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-between text-xs text-slate-400">
        <p>Demonstration system · synthetic telemetry and simulated integrations</p>
        <button
          type="button"
          onClick={toggleVideo}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur hover:bg-white/10 hover:text-white transition-colors"
          title={isPlaying ? 'Pause background animation' : 'Play background animation'}
          aria-label={isPlaying ? 'Pause background animation' : 'Play background animation'}
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          <span>{isPlaying ? 'Motion On' : 'Paused'}</span>
        </button>
      </div>
    </section>
    <section className="flex items-center justify-center bg-slate-50 p-5"><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-2xl"><div className="mb-7 lg:hidden"><p className="text-xl font-bold">GridGuard AI</p></div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">Secure access</p><h2 className="mt-2 text-3xl font-bold">Welcome back</h2><p className="mt-1 text-sm text-slate-500">Sign in with a seeded demonstration account.</p><form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-xs font-semibold">Username<Input className="mt-2" value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username"/></label><label className="block text-xs font-semibold" htmlFor="password">Password<div className="relative mt-2"><Input id="password" data-testid="password-input" type={visible?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password"/><button type="button" onClick={()=>setVisible(!visible)} className="absolute right-3 top-2.5 text-slate-400" aria-label="Toggle password visibility">{visible?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button></div></label>{error&&<p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<Button className="w-full" disabled={pending}>{pending?'Signing in…':'Sign in'}</Button></form><div className="mt-6 border-t border-slate-100 pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Quick demo roles</p><div className="grid grid-cols-2 gap-2">{accounts.map(([name,pass,label])=><button key={name} onClick={()=>{setUsername(name);setPassword(pass)}} className="rounded-lg border border-slate-200 p-2 text-left hover:border-blue-300 hover:bg-blue-50"><p className="text-xs font-bold">{label}</p><p className="text-[10px] text-slate-400">{name}</p></button>)}</div></div></div></section>
  </main>
}
function Feature({icon:Icon,label}:{icon:typeof Zap;label:string}){return <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"><Icon className="h-5 w-5 text-emerald-400"/><p className="mt-3 text-sm font-semibold">{label}</p></div>}
