export type EvidenceTextProjection = {
  text: string
  sourceChars: number
  projectedChars: number
  truncated: boolean
  strategy: 'complete' | 'head_tail'
  reason: string
}

export function projectEvidenceText(
  value: string | null | undefined,
  input: { maxChars: number; reason: string },
): EvidenceTextProjection | null {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (!Number.isInteger(input.maxChars) || input.maxChars < 80) {
    throw new Error('Evidence projection maxChars must be an integer of at least 80')
  }
  if (normalized.length <= input.maxChars) {
    return {
      text: normalized,
      sourceChars: normalized.length,
      projectedChars: normalized.length,
      truncated: false,
      strategy: 'complete',
      reason: input.reason,
    }
  }

  const omission = ' [middle omitted for prompt budget] '
  const available = input.maxChars - omission.length
  const headLength = Math.ceil(available * 0.68)
  const tailLength = available - headLength
  const text = `${normalized.slice(0, headLength).trimEnd()}${omission}${normalized.slice(-tailLength).trimStart()}`
  return {
    text,
    sourceChars: normalized.length,
    projectedChars: text.length,
    truncated: true,
    strategy: 'head_tail',
    reason: input.reason,
  }
}
