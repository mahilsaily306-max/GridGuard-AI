import { describe, it, expect } from 'vitest'
import { formatDate, humanize } from './api'

describe('formatDate', () => {
  it('formats a valid ISO date string', () => {
    expect(formatDate('2026-10-30T09:10:53.280341Z')).toContain('2026')
  })

  it('returns "Unavailable" for undefined', () => {
    expect(formatDate(undefined)).toBe('Unavailable')
  })

  it('returns "Unavailable" for null', () => {
    expect(formatDate(null)).toBe('Unavailable')
  })

  it('returns "Unavailable" for empty string', () => {
    expect(formatDate('')).toBe('Unavailable')
  })
})

describe('humanize', () => {
  it('converts snake_case to Title Case', () => {
    expect(humanize('power_outage')).toBe('Power Outage')
  })

  it('handles single words', () => {
    expect(humanize('overload')).toBe('Overload')
  })

  it('handles multiple underscores', () => {
    expect(humanize('visible_sparking')).toBe('Visible Sparking')
  })
})
