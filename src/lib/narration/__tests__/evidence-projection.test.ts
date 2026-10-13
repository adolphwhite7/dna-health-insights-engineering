import { describe, expect, it } from 'vitest'

import { projectEvidenceText } from '@/lib/narration/evidence-projection'

describe('evidence text projection', () => {
  it('preserves complete source evidence when it fits the surface budget', () => {
    const value = 'DPYD source context '.repeat(20).trim()
    expect(projectEvidenceText(value, { maxChars: 1000, reason: 'fixture' })).toEqual({
      text: value,
      sourceChars: value.length,
      projectedChars: value.length,
      truncated: false,
      strategy: 'complete',
      reason: 'fixture',
    })
  })

  it('records an explicit deterministic head-tail projection instead of silently slicing', () => {
    const value = Array.from({ length: 1200 }, (_, index) => String(index % 10)).join('')
    const first = projectEvidenceText(value, { maxChars: 320, reason: 'fixture budget' })
    const second = projectEvidenceText(value, { maxChars: 320, reason: 'fixture budget' })

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      sourceChars: 1200,
      projectedChars: 320,
      truncated: true,
      strategy: 'head_tail',
      reason: 'fixture budget',
    })
    expect(first?.text).toContain('[middle omitted for prompt budget]')
  })

  it('supports short metadata budgets while rejecting unusably tiny projections', () => {
    const value = 'Clinical Prescribing Guidelines '.repeat(12).trim()
    const projection = projectEvidenceText(value, { maxChars: 120, reason: 'source metadata' })

    expect(projection).toMatchObject({
      projectedChars: 120,
      truncated: true,
      strategy: 'head_tail',
    })
    expect(() => projectEvidenceText(value, { maxChars: 79, reason: 'too small' })).toThrow(
      /at least 80/,
    )
  })
})
