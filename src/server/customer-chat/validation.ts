import type { ApprovedSourceExcerpt, SubjectClass } from "./types";

const UNSAFE_DIRECTION = [
  /\b(?:you have|this proves|this confirms)\s+(?:a disease|cancer|a disorder|a diagnosis)\b/i,
  /\b(?:take|start|stop|increase|decrease|switch)\s+\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b/i,
  /\b(?:stop|start|switch)\s+(?:your\s+)?(?:medication|medicine|prescription)\b/i,
  /\b(?:you should sue|file a lawsuit|legally entitled)\b/i,
  /\b(?:i reviewed|i analyzed)\s+(?:your\s+)?(?:full|entire)\s+(?:genome|dna file)\b/i,
];

const INTERNAL_LANGUAGE = /\b(?:langgraph|node receipt|reason code|provider settlement|system prompt|database row|internal policy)\b/i;

export interface ValidationResult {
  valid: boolean;
  text: string;
  reasonCode: string;
}

export function normalizeCustomerAnswerPlainText(candidate: string): string {
  return candidate
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .trim();
}

export function validateCustomerAnswer(
  candidate: string,
  sources: ApprovedSourceExcerpt[],
  subject: SubjectClass,
): ValidationResult {
  const text = normalizeCustomerAnswerPlainText(candidate);
  if (!text || text.length > 12_000 || INTERNAL_LANGUAGE.test(text) || UNSAFE_DIRECTION.some((rule) => rule.test(text))) {
    const directSource = sources.find((source) => source.text.trim().length > 0);
    return directSource
      ? {
          valid: false,
          text: directSource.text.slice(0, 3_000),
          reasonCode: "DIRECT_SOURCE_FALLBACK",
        }
      : {
          valid: false,
          text: "I couldn't prepare a safe, source-grounded answer. Please try a more specific question or contact support.",
          reasonCode: "SAFE_RETRY_FALLBACK",
        };
  }
  const asksMedicalDirection = subject === "MEDICAL_OR_DOSING";
  if (asksMedicalDirection && !/\b(?:can't|cannot|not able|do not|don't)\b.{0,50}\b(?:diagnos|treat|dose|prescrib|medical)\b/is.test(text)) {
    return {
      valid: false,
      text:
        `${text}\n\nI can explain the released educational finding, but I can't diagnose a condition or choose a treatment or dose. A clinician or pharmacist who knows your full history can help apply it safely.`,
      reasonCode: "EDUCATIONAL_BOUNDARY_APPENDED",
    };
  }
  return { valid: true, text, reasonCode: "VALIDATED_GROUNDED_ANSWER" };
}
