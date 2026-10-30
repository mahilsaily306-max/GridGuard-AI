import { useEffect, useRef } from 'react'

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  baseRadius: number
  isAlert?: boolean
  alertPhase?: number
}

interface Pulse {
  sourceIdx: number
  targetIdx: number
  progress: number
  speed: number
  color: string
}

export function SmartGridCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = 0
    let height = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // Reduced motion check
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.scale(dpr, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    // Mouse tracking
    const mouse = { x: -1000, y: -1000, active: false }
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
      mouse.active = true
    }
    const onMouseLeave = () => {
      mouse.active = false
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseleave', onMouseLeave)

    // Generate Nodes
    const nodeCount = Math.max(28, Math.floor((width * height) / 22000))
    const nodes: Node[] = []

    for (let i = 0; i < nodeCount; i++) {
      const isAlert = i === 4 || i === 12
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        baseRadius: isAlert ? 3.5 : Math.random() * 1.5 + 2,
        isAlert,
        alertPhase: Math.random() * Math.PI * 2,
      })
    }

    // Active electrical transmission pulses
    const pulses: Pulse[] = []
    const maxPulses = 12

    let lastTime = performance.now()

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time

      ctx.clearRect(0, 0, width, height)

      // Update node positions
      if (!prefersReducedMotion) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]
          n.x += n.vx
          n.y += n.vy

          // Gentle bounce off edges
          if (n.x < 20) { n.x = 20; n.vx *= -1 }
          if (n.x > width - 20) { n.x = width - 20; n.vx *= -1 }
          if (n.y < 20) { n.y = 20; n.vy *= -1 }
          if (n.y > height - 20) { n.y = height - 20; n.vy *= -1 }

          // Animate alert phase
          if (n.isAlert && n.alertPhase !== undefined) {
            n.alertPhase = (n.alertPhase + dt * 2.5) % (Math.PI * 2)
          }
        }
      }

      // Draw Grid Connections (Power Distribution Lines)
      const connectionDist = Math.min(width, height) * 0.32
      const activeEdges: [number, number, number][] = []

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < connectionDist) {
            activeEdges.push([i, j, dist])
            const alpha = (1 - dist / connectionDist) * 0.22

            ctx.beginPath()
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)

            if (nodes[i].isAlert || nodes[j].isAlert) {
              ctx.strokeStyle = `rgba(245, 158, 11, ${alpha * 1.4})`
            } else {
              ctx.strokeStyle = `rgba(0, 229, 153, ${alpha})`
            }
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }
      }

      // Mouse interactive connection lines
      if (mouse.active) {
        const mouseRange = 160
        for (let i = 0; i < nodes.length; i++) {
          const dx = nodes[i].x - mouse.x
          const dy = nodes[i].y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < mouseRange) {
            const alpha = (1 - dist / mouseRange) * 0.45
            ctx.beginPath()
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(mouse.x, mouse.y)
            ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`
            ctx.lineWidth = 1.2
            ctx.stroke()
          }
        }
      }

      // Spawn electrical energy pulses along edges
      if (!prefersReducedMotion && activeEdges.length > 0 && pulses.length < maxPulses && Math.random() < 0.08) {
        const edge = activeEdges[Math.floor(Math.random() * activeEdges.length)]
        const hasAlert = nodes[edge[0]].isAlert || nodes[edge[1]].isAlert
        pulses.push({
          sourceIdx: edge[0],
          targetIdx: edge[1],
          progress: 0,
          speed: Math.random() * 0.4 + 0.35,
          color: hasAlert ? '#f59e0b' : Math.random() > 0.3 ? '#00e599' : '#38bdf8',
        })
      }

      // Update and Draw Electrical Energy Pulses
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pulse = pulses[p]
        pulse.progress += pulse.speed * dt

        if (pulse.progress >= 1) {
          pulses.splice(p, 1)
          continue
        }

        const n1 = nodes[pulse.sourceIdx]
        const n2 = nodes[pulse.targetIdx]
        const px = n1.x + (n2.x - n1.x) * pulse.progress
        const py = n1.y + (n2.y - n1.y) * pulse.progress

        // Glowing pulse head
        ctx.beginPath()
        ctx.arc(px, py, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = pulse.color
        ctx.shadowColor = pulse.color
        ctx.shadowBlur = 8
        ctx.fill()
        ctx.shadowBlur = 0

        // Subtle comet tail
        const tailProgress = Math.max(0, pulse.progress - 0.12)
        const tx = n1.x + (n2.x - n1.x) * tailProgress
        const ty = n1.y + (n2.y - n1.y) * tailProgress

        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(tx, ty)
        ctx.strokeStyle = pulse.color
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Draw Transformer Nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]

        if (n.isAlert) {
          // Warning / Overload Anomaly Transformer Node
          const phase = n.alertPhase || 0
          const pulseScale = 1 + 0.2 * Math.sin(phase)

          // Radar diagnostic wave ring
          const ringRadius = n.baseRadius + 14 * ((phase / (Math.PI * 2)) % 1)
          const ringAlpha = (1 - (phase / (Math.PI * 2)) % 1) * 0.75

          ctx.beginPath()
          ctx.arc(n.x, n.y, ringRadius, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(245, 158, 11, ${ringAlpha})`
          ctx.lineWidth = 1
          ctx.stroke()

          // Secondary halo
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.baseRadius * 2.8 * pulseScale, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(245, 158, 11, 0.18)'
          ctx.fill()

          // Core node
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.baseRadius * pulseScale, 0, Math.PI * 2)
          ctx.fillStyle = '#f59e0b'
          ctx.shadowColor = '#f59e0b'
          ctx.shadowBlur = 12
          ctx.fill()
          ctx.shadowBlur = 0
        } else {
          // Normal Healthy Transformer / Substation Node
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.baseRadius, 0, Math.PI * 2)
          ctx.fillStyle = '#00e599'
          ctx.shadowColor = '#00e599'
          ctx.shadowBlur = 6
          ctx.fill()
          ctx.shadowBlur = 0

          // Center spark dot
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.baseRadius * 0.4, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
        }
      }

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(render)
      }
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-auto absolute inset-0 h-full w-full opacity-80"
      style={{ display: 'block' }}
    />
  )
}
