import {
  REFUND_POLICY_ROUTE,
  REFUND_POLICY_SHORT_SUMMARY,
  REFUND_REQUEST_ROUTE,
} from "@/lib/refund-policy-content";
import { formatPrice, TIER_CONFIG } from "@/lib/tier-config";

import type { ApprovedSourceExcerpt, SubjectClass } from "./types";

export const CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION = "customer-safe-support-v1";

const SUPPORT_ENTRIES: Readonly<Record<string, ApprovedSourceExcerpt>> = {
  how_it_works: {
    ref: `${CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION}:how-it-works`,
    kind: "CONSTITUTION",
    title: "How DNA Health Insights works",
    text:
      "DNA Health Insights creates structured findings when a customer processes a compatible DNA file in the browser. Customer-facing reports and finding explanations are generated from approved structured records. Chat explains information already available in the signed-in account and does not inspect or receive the full raw genome file.",
  },
  billing: {
    ref: `${CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION}:billing`,
    kind: "CONSTITUTION",
    title: "Billing and refunds",
    text:
      `${REFUND_POLICY_SHORT_SUMMARY} Full terms are at ${REFUND_POLICY_ROUTE}, and the signed-in refund request flow is at ${REFUND_REQUEST_ROUTE}. ` +
      `Current public pricing is ${TIER_CONFIG.tier1.marketingName} at ${formatPrice(TIER_CONFIG.tier1.pricing.oneTime!)} one-time, ` +
      `${TIER_CONFIG.tier2.marketingName} at ${formatPrice(TIER_CONFIG.tier2.pricing.monthly!)}/month or ${formatPrice(TIER_CONFIG.tier2.pricing.annual!)}/year, and ` +
      `${TIER_CONFIG.tier3.marketingName} at ${formatPrice(TIER_CONFIG.tier3.pricing.monthly!)}/month or ${formatPrice(TIER_CONFIG.tier3.pricing.annual!)}/year. ` +
      "Major credit cards and supported digital wallets are accepted through the secure payment processor. Account-specific charge, refund, cancellation, or payment disputes must be sent to staff and must not be guessed or represented as resolved.",
  },
  technical: {
    ref: `${CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION}:technical`,
    kind: "CONSTITUTION",
    title: "Technical and narration support",
    text:
      "If a report or finding narration that should be available does not generate or load, acknowledge the problem and create a minimal support request. Do not trigger narration generation from chat and do not claim staff action until the support row commits.",
  },
  genetics: {
    ref: `${CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION}:genetics`,
    kind: "GENERAL_GENETICS",
    title: "Educational genetics boundary",
    text:
      "Genes, variants, rsIDs, genotypes, and finding names are appropriate educational topics. Explain them clearly when grounded in approved sources. Do not diagnose, prescribe, select a dose or treatment, promise an outcome, or imply review of the customer's full genome or hidden findings.",
  },
  privacy: {
    ref: `${CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION}:privacy`,
    kind: "CONSTITUTION",
    title: "Privacy and account actions",
    text:
      "A customer's full genomic file is parsed locally in the supported browser, is never accepted by chat, and is not uploaded to DNA Health Insights. Limited population-shared structured findings and generated report content are used to provide the educational service. Chat conversations are saved to the signed-in account for 7 days and are not used to train models. A provider-backed answer transfers only the current question, up to six recent retained messages, and up to three directly relevant approved source excerpts to the standard Anthropic API; standard API retention is up to 30 days, subject to provider exceptions. DNA Health Insights does not sell genetic data or share it for advertising. Limited service providers support hosting, payments, email, and approved AI-assisted narration as described in the Privacy Policy at /legal/privacy_policy. A signed-in customer can request deletion from account settings and request an export where available before deletion. Deletion, export, correction, and other account actions require the authoritative account or support flow; chat never claims they occurred without system proof. Limited billing, consent, legal, security, tax, audit, or dispute records may still be retained as described in the Privacy Policy. Explain these processes without legal advice.",
  },
  crisis: {
    ref: `${CUSTOMER_SAFE_SUPPORT_REGISTRY_VERSION}:crisis`,
    kind: "CONSTITUTION",
    title: "Immediate safety",
    text:
      "If someone describes immediate danger or intent to harm themselves or another person, encourage contacting local emergency services now. In the United States, call or text 988 for crisis support. Do not claim monitoring or that the company contacted anyone.",
  },
};

export function constitutionSourcesFor(subject: SubjectClass): ApprovedSourceExcerpt[] {
  switch (subject) {
    case "IMMINENT_DANGER":
    case "AMBIGUOUS_DISTRESS":
      return [SUPPORT_ENTRIES.crisis];
    case "BILLING_POLICY":
    case "BILLING_DISPUTE":
      return [SUPPORT_ENTRIES.billing];
    case "TECHNICAL_FAILURE":
    case "VISIBLE_NOT_GENERATED":
    case "ACCOUNT_INTEGRITY":
      return [SUPPORT_ENTRIES.technical];
    case "LEGAL_OR_PRIVACY":
      return [SUPPORT_ENTRIES.privacy];
    case "GENERAL_GENETICS":
    case "DELIVERED_REPORT":
    case "READY_FINDING":
    case "MEDICAL_OR_DOSING":
      return [SUPPORT_ENTRIES.genetics];
    default:
      return [SUPPORT_ENTRIES.how_it_works];
  }
}

export function deterministicAnswerFor(subject: SubjectClass): string | null {
  switch (subject) {
    case "VISIBLE_NOT_GENERATED":
      return "If the finding is visible in your account but does not yet have an educational summary, generate that summary from its normal page first. Once it is available, I can help explain it. Chat does not generate or unlock finding narrations.";
    case "IMMINENT_DANGER":
      return "If you or someone else may be in immediate danger, call local emergency services now. In the United States, you can also call or text 988 for crisis support. This chat is not monitored as an emergency service.";
    case "AMBIGUOUS_DISTRESS":
      return "I’m sorry this feels difficult. Are you in immediate danger or thinking about harming yourself or someone else? If yes, call local emergency services now; in the United States, you can also call or text 988.";
    default:
      return null;
  }
}
