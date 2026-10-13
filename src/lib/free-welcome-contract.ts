export const FREE_WELCOME_FINDING_COUNT = 3
export const FREE_WELCOME_LIFESTYLE_FINDING_INVARIANT =
  'FREE_WELCOME_LIFESTYLE_FINDING_INVARIANT'

export class FreeWelcomeFindingInvariantError extends Error {
  readonly code = FREE_WELCOME_LIFESTYLE_FINDING_INVARIANT
  readonly permanent = true
  readonly actualCount: number
  readonly reason: 'count' | 'identity'

  constructor(actualCount: number, reason: 'count' | 'identity' = 'count') {
    super(reason === 'identity'
      ? 'Free Welcome selected and rendered finding identities do not match.'
      : `Free Welcome requires exactly ${FREE_WELCOME_FINDING_COUNT} lifestyle findings; received ${actualCount}.`)
    this.name = FREE_WELCOME_LIFESTYLE_FINDING_INVARIANT
    this.actualCount = actualCount
    this.reason = reason
  }
}

export function assertFreeWelcomeFindingCount(actualCount: number): void {
  if (actualCount !== FREE_WELCOME_FINDING_COUNT) {
    throw new FreeWelcomeFindingInvariantError(actualCount)
  }
}
