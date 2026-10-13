/**
 * Central model resolver: per-role environment override, allowlisted default,
 * and a separate allowed set for customer-facing narration.
 *
 * The selected source illustrates the resolver. This inspection package does
 * not execute providers or prescribe a current model deployment.
 */

export type ModelRole =
  | 'default_narration'
  | 'escalation'
  | 'judge'
  | 'supplement'
  | 'supplement_body'
  | 'command_center'
  | 'report_finding'
  | 'performance_suite'
  | 'renarration'
  | 'educational_summary'
  | 'customer_chat';

/** Approved model identifiers in this source snapshot. */
export const APPROVED_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-5',
] as const;
export type ApprovedModel = (typeof APPROVED_MODELS)[number];
const APPROVED = new Set<string>(APPROVED_MODELS);

/** Separate allowed set for customer-facing narration. */
export const PRODUCTION_NARRATOR_MODELS = new Set<string>([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-5',
]);

/** Roles that author customer-facing narrative (subject to the narrator allowlist). `judge` is an internal evaluator, not gated. */
const PRODUCTION_NARRATOR_ROLES = new Set<ModelRole>([
  'default_narration',
  'escalation',
  'supplement',
  'supplement_body',
  'command_center',
  'report_finding',
  'performance_suite',
  'renarration',
  'educational_summary',
  'customer_chat',
]);

/** Per-role env var (matches the existing knobs; `supplement` is newly consolidated from a hardcoded literal). */
const ROLE_ENV: Record<ModelRole, string> = {
  default_narration: 'NARRATIVE_DEFAULT_MODEL',
  escalation: 'NARRATIVE_ESCALATION_MODEL',
  judge: 'NARRATION_JUDGE_MODEL',
  supplement: 'SUPPLEMENT_NARRATIVE_MODEL',
  supplement_body: 'SUPPLEMENT_BODY_MODEL_VERSION',
  command_center: 'COMMAND_CENTER_BODY_MODEL_VERSION',
  report_finding: 'REPORT_FINDING_AUTHORING_MODEL_VERSION',
  performance_suite: 'PERFORMANCE_SUITE_BODY_MODEL_VERSION',
  renarration: 'NARRATIVE_DEFAULT_MODEL',
  educational_summary: 'NARRATION_MODEL',
  customer_chat: 'CUSTOMER_CHAT_MODEL',
};

/** Role defaults from the selected source snapshot. */
const ROLE_DEFAULT: Record<ModelRole, ApprovedModel> = {
  default_narration: 'claude-sonnet-5',
  escalation: 'claude-sonnet-5',
  judge: 'claude-sonnet-5',
  supplement: 'claude-sonnet-5',
  supplement_body: 'claude-sonnet-5',
  command_center: 'claude-sonnet-5',
  report_finding: 'claude-sonnet-5',
  performance_suite: 'claude-sonnet-5',
  renarration: 'claude-sonnet-5',
  educational_summary: 'claude-sonnet-5',
  customer_chat: 'claude-sonnet-5',
};

export class ModelNotAllowedError extends Error {
  readonly code = 'MODEL_NOT_ALLOWED';
  constructor(modelId: string, role: ModelRole) {
    super(
      `Model "${modelId}" for role "${role}" is not in the approved model allowlist ` +
        `(${APPROVED_MODELS.join(', ')}).`,
    );
    this.name = 'ModelNotAllowedError';
  }
}

/**
 * Resolve the model id for a role. env (per role) -> hardcoded default, allowlist-gated,
 * Narrator-allowlist-gated for production-narrator roles. Never returns a non-approved model.
 *
 * @throws {ModelNotAllowedError} only when the hardcoded default itself is misconfigured
 *   (config bug) — an unapproved ENV value silently degrades to the safe default.
 */
export function modelFor(role: ModelRole): ApprovedModel {
  const raw = (process.env[ROLE_ENV[role]] ?? '').trim();
  const candidate = raw && APPROVED.has(raw) ? raw : ROLE_DEFAULT[role];

  if (!APPROVED.has(candidate)) {
    throw new ModelNotAllowedError(candidate, role);
  }

  if (PRODUCTION_NARRATOR_ROLES.has(role) && !PRODUCTION_NARRATOR_MODELS.has(candidate)) {
    // A production-narrator role resolved to a non-approved-narrator model.
    // Degrade to the role default if it is an approved narrator; else fail closed.
    const fallback = ROLE_DEFAULT[role];
    if (PRODUCTION_NARRATOR_MODELS.has(fallback)) {
      return fallback;
    }
    throw new ModelNotAllowedError(candidate, role);
  }

  return candidate as ApprovedModel;
}

/** True iff `modelId` is in the approved allowlist. For call sites replacing ad-hoc guards. */
export function isApprovedModel(modelId: string): modelId is ApprovedModel {
  return APPROVED.has(modelId);
}
