import type { CustomerChatMessageAction, SubjectClass } from "./types";

const IMMINENT_DANGER = /\b(?:kill myself|suicide|suicidal|overdose now|hurt myself|hurt someone|immediate danger)\b/i;
const AMBIGUOUS_DISTRESS = /\b(?:hopeless|can't go on|cannot go on|everything is pointless|not safe)\b/i;
const BILLING_DISPUTE =
  /\b(?:charged|chargeback|wrong charge|double charged|my refund|refund status|cancel my|billing dispute|(?:provide|issue|process) refunds? for (?:my|this|the) (?:order|purchase|charge)|refund (?:my|this|the) (?:order|purchase|charge))\b/i;
const BILLING_POLICY =
  /\b(?:refund (?:policy|terms|window|eligibility|rules?|process)|(?:do|does) (?:you|we|the (?:site|service)) (?:offer|allow|provide) refunds?|how (?:do|does) refunds? work|explain (?:your |the )?refund process|what plans? (?:do|does) (?:you|we|the (?:site|service)) offer|billing policy|prices?|pricing|subscription|payment plans?|payment (?:methods?|options?)|credit cards?|digital wallets?)\b/i;
const COMMERCIAL_COST =
  /\bhow much (?:is|are) (?:your |the )?(?:service|subscription|plans?)\b|\bhow much (?:is|are) (?:it|this)\s*[?.!]*\s*$|\b(?:how much|what) (?:does|do|will|would) (?:your |the )?(?:service|subscription|plans?) cost\b|\b(?:how much|what) (?:does|do|will|would) (?:it|this) cost\s*[?.!]*\s*$|\b(?:your |the )?(?:service|subscription|plans?) costs?\b/i;
const TECHNICAL = /\b(?:error|failed|failure|won't load|will not load|stuck|missing narration|not generating|upload problem|broken)\b/i;
const REPORT = /\b(?:my reports?|generated reports?|reports? says?|results say|welcome report|lifestyle report)\b/i;
const REPORT_INVENTORY =
  /\b(?:reports? generated on my account|reports? on my account|reports? (?:are )?available (?:in|on) my account|what reports? (?:are|have been) generated|which reports? (?:are|have been) generated|what genes? (?:do|does) (?:those|my) reports? cover)\b/i;
const REPORT_PROCESS = /\b(?:how (?:are|do) reports? (?:get )?generated|how is (?:a )?report generated|how (?:are|do) reports? created)\b/i;
const FINDING = /\b(?:my finding|helix|performance suite|supplement context|finding says|narration)\b/i;
const NOT_GENERATED = /\b(?:not generated|haven't generated|have not generated|no summary|click to generate)\b/i;
const MEDICAL = /\b(?:diagnos(?:e|is)|treat(?:ment)?|what dose|dosage|how much should i take|stop taking|start taking|prescribe|cure)\b/i;
const LEGAL = /\b(?:legal advice|sue|lawsuit|attorney|lawyer|privacy right|delete my data|export my data)\b/i;
const CHAT_RECORD = /\b(?:chats?|conversations?|transcripts?|messages?)\b/i;
const CHAT_DATA_POLICY =
  /\b(?:privacy|retention|retain(?:ed|s|ing)?|stor(?:e|ed|age|ing)|sav(?:e|ed|ing)|kept|expir(?:e|es|ed|ing|ation)|delet(?:e|ed|ing|ion)|export(?:ed|ing)?)\b/i;
const CHAT_MODEL_TRAINING_POLICY =
  /\b(?:chats?|conversations?|transcripts?|messages?|(?:chat|conversation) history)\b.{0,80}\b(?:use(?:d|s|ing)? for (?:model )?training|to train (?:an? |your |the )?(?:ai|models?)|model training)\b|\b(?:train(?:ed|ing)?(?:(?: an?| your| the) (?:ai|models?))? (?:on|using|with|from)|use(?:d|s|ing)? .{0,40}to train)\b.{0,80}\b(?:chats?|conversations?|transcripts?|messages?|(?:chat|conversation) history)\b/i;
const CHAT_KEEP_POLICY = /\b(?:do|does|will) (?:you|we|the (?:site|service)) keep\b/i;
const CHAT_TRANSCRIPT_AVAILABILITY =
  /\b(?:transcripts?|messages?|(?:chat|conversation) history)\b.{0,40}\bavailable\b|\bavailable\b.{0,40}\b(?:transcripts?|messages?|(?:chat|conversation) history)\b/i;
const CHAT_CUSTOMER_HISTORY_REFERENCE =
  /\b(?:transcripts?|(?:chat|conversation) history|chat (?:messages?|conversations?))\b|\b(?:i|my|we|our)\b.{0,80}\b(?:messages?|conversations?)\b/i;
const CHAT_RETENTION_DURATION =
  /\b(?:how long|how many days|for how (?:many|long)|until when)\b.{0,80}\b(?:transcripts?|messages?|conversations?|(?:chat|conversation) history)\b|\b(?:transcripts?|messages?|conversations?|(?:chat|conversation) history)\b.{0,80}\b(?:how long|how many days|for how (?:many|long)|until when)\b/i;
const CHAT_OLDER_HISTORY_ACCESS =
  /\b(?:view|see|access|find|open)\b.{0,40}\b(?:old|past|previous|earlier)\b.{0,40}\b(?:transcripts?|messages?|conversations?|(?:chat|conversation) history)\b|\b(?:old|past|previous|earlier)\b.{0,40}\b(?:transcripts?|messages?|conversations?|(?:chat|conversation) history)\b.{0,40}\b(?:view|see|access|find|open)\b/i;
const CHAT_RUNTIME_TIMING =
  /\b(?:take|takes|taking) (?:to )?(?:load|respond|reply|answer)\b|\b(?:loading|response time|latency|wait time)\b/i;
const ACCOUNT_INTEGRITY = /\b(?:someone accessed|account hacked|identity theft|not my report|wrong person's|security breach)\b/i;
const GENERAL_GENETICS = /\b(?:gene|variant|genotype|rs\d+|allele|heterozyg|homozyg|genetic)\b/i;
const PERSONAL_GENETICS = /\b(?:my|mine|i have|my results?|my dna)\b.{0,80}\b(?:gene|variant|genotype|rs\d+|allele|heterozyg|homozyg|genetic)\b|\b(?:gene|variant|genotype|rs\d+|allele|heterozyg|homozyg|genetic)\b.{0,80}\b(?:in my|from my|mine)\b/i;
const GENERAL_EDUCATION_CUE = /\b(?:generally|in general|educationally|population-wide)\b/i;
const PRODUCT =
  /\b(?:how (?:does|do) (?:the site|this|dna health insights)|how it works|contact support|sign(?:ing)?[ -]?in|log(?:ging)?[ -]?in|account|website|service)\b/i;
const ACCOUNT_ACTIVE_REQUEST =
  /\b(?:how (?:do|can) i|can (?:i|you|someone)|could (?:i|you|someone)|i (?:need|want|would like)(?: help)?(?: to)?|please)\b.{0,60}\b(?:chang(?:e|ing)|updat(?:e|ing)(?!\s+me\b)|edit(?:ing)?|verify(?:ing)?|access(?:ing)?|recover(?:ing)?|reset(?:ting)?|clos(?:e|ing)|delet(?:e|ing)|remov(?:e|ing)|cancel(?:ing)?|unlock(?:ing)?|replac(?:e|ing)|manag(?:e|ing)|upgrad(?:e|ing)|downgrad(?:e|ing)|switch(?:ing)?)\b.{0,120}\b(?:account|profile|email(?: address)?|phone(?: number)?|password|username|log[ -]?in|sign[ -]?in|credit card|subscriptions?|plans?|contact (?:details?|information)|(?:payment|billing) (?:method|address|details?|information))\b/i;
const ACCOUNT_DIRECT_HELP =
  /\b(?:help(?: me)?|assistance|support) (?:with|on|for) (?:my )?(?:account|profile|email(?: address)?|phone(?: number)?|password|username|log[ -]?in|sign[ -]?in|credit card|(?:payment|billing) (?:method|address|details?|information))\b/i;
const ACCOUNT_SETTINGS_NAVIGATION =
  /\b(?:where|find|open|access|manage)\b.{0,60}\b(?:my )?(?:account|profile) settings?\b/i;
const PAYMENT_CARD_HOUSEKEEPING =
  /\b(?:credit card|payment method)\b.{0,50}\b(?:chang(?:e|ed|ing)|updat(?:e|ed|ing)|replac(?:e|ed|ing)|expir(?:e|ed|es|ing))\b|\b(?:chang(?:e|ing)|updat(?:e|ing)|replac(?:e|ing))\b.{0,50}\b(?:credit card|payment method)\b/i;
const ACCOUNT_PASSIVE_CHANGE =
  /\b(?:can|could|should)\b.{0,40}\b(?:the |my )?(?:account|profile|email(?: address)?|phone(?: number)?|password|username|credit card|subscriptions?|plans?|(?:payment|billing) (?:method|address|details?|information))\b.{0,80}\b(?:changed|updated|edited|verified|recovered|reset|closed|deleted|removed|cancelled|unlocked|replaced|upgraded|downgraded|switched)\b/i;
const ACCOUNT_FIELD_PROBLEM =
  /\bmy\b.{0,30}\b(?:account|profile|email(?: address)?|phone(?: number)?|password|username|credit card|subscriptions?|plans?|(?:payment|billing) (?:method|address|details?|information))\b.{0,60}\b(?:wrong|incorrect|outdated|inactive|expired|expiring|cancell?ed|locked|disabled|missing|not working)\b/i;
const CONTACT_SUPPORT_REQUEST =
  /\b(?:how|where) (?:do|can) i (?:contact|reach|message|email) (?:customer )?support\b|\bcontact (?:customer )?support\b/i;
const ACCOUNT_ACCESS_PROBLEM =
  /\b(?:i (?:can(?:not|'t|’t)|cannot)|unable to) (?:sign|log)[ -]?in\b|\b(?:i )?(?:need|want|would like) help (?:signing|logging)[ -]?in\b|\bhelp(?: me)? (?:sign|log)[ -]?in\b|\bi (?:can(?:not|'t|’t)|cannot|am unable to) access my account\b|\bi(?:'m|’m| am) locked out of my account\b/i;
const SUPPORTABLE_NON_FINDING =
  /\b(?:account|profile|email|password|billing|payment|refund|subscription|plan|receipt|invoice|purchase|website|contact|support)\b/i;

export function routeCustomerChatSubject(message: string): SubjectClass {
  if (IMMINENT_DANGER.test(message)) return "IMMINENT_DANGER";
  if (AMBIGUOUS_DISTRESS.test(message)) return "AMBIGUOUS_DISTRESS";
  if (ACCOUNT_INTEGRITY.test(message)) return "ACCOUNT_INTEGRITY";
  if (BILLING_DISPUTE.test(message)) return "BILLING_DISPUTE";
  if (TECHNICAL.test(message)) return "TECHNICAL_FAILURE";
  if (NOT_GENERATED.test(message) && FINDING.test(message)) return "VISIBLE_NOT_GENERATED";
  if (MEDICAL.test(message)) return "MEDICAL_OR_DOSING";
  if (
    LEGAL.test(message) ||
    (CHAT_RECORD.test(message) &&
      (CHAT_DATA_POLICY.test(message) ||
        CHAT_MODEL_TRAINING_POLICY.test(message) ||
        CHAT_KEEP_POLICY.test(message) ||
        CHAT_TRANSCRIPT_AVAILABILITY.test(message) ||
        (CHAT_CUSTOMER_HISTORY_REFERENCE.test(message) &&
          !CHAT_RUNTIME_TIMING.test(message) &&
          (CHAT_RETENTION_DURATION.test(message) || CHAT_OLDER_HISTORY_ACCESS.test(message)))))
  ) {
    return "LEGAL_OR_PRIVACY";
  }
  const explicitMarkers = populationMarkersFrom(message);
  if (
    explicitMarkers.length > 0 &&
    (!GENERAL_EDUCATION_CUE.test(message) || REPORT.test(message) || PERSONAL_GENETICS.test(message))
  ) {
    return "READY_FINDING";
  }
  if (REPORT_PROCESS.test(message)) return "PRODUCT_SUPPORT";
  if (REPORT_INVENTORY.test(message)) return "DELIVERED_REPORT";
  if (REPORT.test(message)) return "DELIVERED_REPORT";
  if (FINDING.test(message)) return "READY_FINDING";
  if (BILLING_POLICY.test(message) || COMMERCIAL_COST.test(message)) return "BILLING_POLICY";
  if (PERSONAL_GENETICS.test(message)) return "READY_FINDING";
  if (GENERAL_GENETICS.test(message)) return "GENERAL_GENETICS";
  if (PRODUCT.test(message)) return "PRODUCT_SUPPORT";
  return "OUT_OF_SCOPE";
}

export function subjectNeedsHandoff(subject: SubjectClass): boolean {
  return (
    subject === "BILLING_DISPUTE" ||
    subject === "TECHNICAL_FAILURE" ||
    subject === "ACCOUNT_INTEGRITY"
  );
}

export function customerActionForSubject(
  subject: SubjectClass,
  message: string,
): CustomerChatMessageAction | null {
  if (subjectNeedsHandoff(subject)) return "CONTACT_FORM";
  const supportsHousekeepingAction =
    subject === "OUT_OF_SCOPE" ||
    subject === "PRODUCT_SUPPORT" ||
    subject === "BILLING_POLICY";
  if (
    supportsHousekeepingAction &&
    (ACCOUNT_ACTIVE_REQUEST.test(message) ||
      ACCOUNT_DIRECT_HELP.test(message) ||
      ACCOUNT_SETTINGS_NAVIGATION.test(message) ||
      PAYMENT_CARD_HOUSEKEEPING.test(message) ||
      ACCOUNT_PASSIVE_CHANGE.test(message) ||
      ACCOUNT_FIELD_PROBLEM.test(message) ||
      CONTACT_SUPPORT_REQUEST.test(message) ||
      ACCOUNT_ACCESS_PROBLEM.test(message))
  ) {
    return "CONTACT_FORM";
  }
  if (subject === "OUT_OF_SCOPE" && SUPPORTABLE_NON_FINDING.test(message)) {
    return "CONTACT_FORM";
  }
  return null;
}

export function subjectCanUseProvider(subject: SubjectClass): boolean {
  return (
    subject === "PRODUCT_SUPPORT" ||
    subject === "BILLING_POLICY" ||
    subject === "LEGAL_OR_PRIVACY" ||
    subject === "GENERAL_GENETICS" ||
    subject === "DELIVERED_REPORT" ||
    subject === "READY_FINDING" ||
    subject === "MEDICAL_OR_DOSING" ||
    subject === "OUT_OF_SCOPE"
  );
}

export function populationMarkerFrom(message: string): string | null {
  return populationMarkersFrom(message)[0] ?? null;
}

const NON_MARKER_TOKENS = new Set([
  "ABOUT",
  "ACCOUNT",
  "AGING",
  "AN",
  "AND",
  "ARE",
  "ASSOCIATED",
  "AVAILABLE",
  "API",
  "CAN",
  "COVER",
  "DNA",
  "DOES",
  "EXPLAIN",
  "FOR",
  "FROM",
  "FUNCTION",
  "GENE",
  "GENES",
  "GENERATED",
  "FINDING",
  "FINDINGS",
  "GENOTYPE",
  "GENOTYPES",
  "INFORMATION",
  "EXPRESSED",
  "HAVE",
  "HELP",
  "HOW",
  "HEALTH",
  "IT",
  "MARKER",
  "MARKERS",
  "ME",
  "MEAN",
  "MY",
  "PLEASE",
  "QUESTION",
  "REPORT",
  "REPORTS",
  "RESPONSE",
  "RESULT",
  "RESULTS",
  "RISK",
  "SAY",
  "SAYS",
  "SEE",
  "SKIN",
  "TELL",
  "THE",
  "THIS",
  "THOSE",
  "TRAIT",
  "UNDERSTAND",
  "USA",
  "VARIANT",
  "VARIANTS",
  "VITAMIN",
  "WHAT",
  "WITH",
  "YOU",
  "YOUR",
]);

export function populationMarkersFrom(message: string): string[] {
  const searchable = message.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    " ",
  );
  const rsids = searchable.match(/\brs\d{1,15}\b/gi) ?? [];
  const digitBearingGenes = (searchable.match(/\b(?=[a-z0-9-]*\d)[a-z][a-z0-9-]{2,11}\b/gi) ?? [])
    .filter((value) => (value.match(/[A-Z]/g)?.length ?? 0) >= 2);
  const hasMixedCaseProse = /[a-z]/.test(searchable) && /[A-Z]/.test(searchable);
  const uppercaseGenes = hasMixedCaseProse
    ? searchable.match(/\b[A-Z][A-Z0-9-]{2,11}\b/g) ?? []
    : [];
  const slashGenotypes = searchable.match(/\b[ACGT]{1,3}[\/|][ACGT]{1,3}\b/gi) ?? [];
  const namedGenotypes = [
    ...searchable.matchAll(/\bgenotype\s+(?:is\s+)?([ACGT]{2,3})\b/gi),
    ...searchable.matchAll(/\b([ACGT]{2,3})\s+genotype\b/gi),
  ].map((match) => match[1]);
  const explicitCueGenes = [
    ...searchable.matchAll(/\b(?:gene|variant|finding)\s+([a-z][a-z0-9-]{2,11})\b/gi),
    ...searchable.matchAll(/\b(?:my|the)\s+([a-z][a-z0-9-]{2,11})\s+(?:gene|variant|finding|genotype)\b/gi),
    ...searchable.matchAll(/\b(?:explain|understand|tell me about)\s+(?:the\s+)?([a-z][a-z0-9-]{2,11})\s+(?:gene|variant|finding)\b/gi),
  ].map((match) => match[1]);
  const contextualCueGenes = [
    ...searchable.matchAll(/\bwhat does\s+(?:my\s+)?([a-z][a-z0-9-]{2,11})(?:\s+(?:gene|variant|finding|genotype|result))?\s+mean\b/gi),
    ...searchable.matchAll(/\btell me about\s+(?:my\s+)?([a-z][a-z0-9-]{2,11})\b/gi),
    ...searchable.matchAll(/\breports?\s+(?:say|says)\s+about\s+([a-z][a-z0-9-]{2,11})\b/gi),
    ...searchable.matchAll(/\b(?:explain|understand)\s+(?:my\s+)?([a-z][a-z0-9-]{2,11})\b/gi),
  ]
    .map((match) => match[1])
    .filter(
      (value) =>
        /\d/.test(value) ||
        value === value.toUpperCase() ||
        REPORT.test(searchable) ||
        FINDING.test(searchable) ||
        /\b(?:my account|my results?)\b/i.test(searchable),
    );
  const reportCueGenes = [
    ...searchable.matchAll(/\breports?\s+(?:say|says)\s+([a-z][a-z0-9-]{2,11})\b/gi),
  ]
    .map((match) => match[1])
    .filter((value) => value === value.toUpperCase() || /\d/.test(value));
  const normalized = [
    ...rsids.map((value) => value.toLowerCase()),
    ...digitBearingGenes.map((value) => value.replace(/-+$/, "").toUpperCase()),
    ...uppercaseGenes.map((value) => value.replace(/-+$/, "").toUpperCase()),
    ...slashGenotypes.map((value) => value.toUpperCase().replace("|", "/")),
    ...namedGenotypes.map((value) => value.toUpperCase()),
    ...explicitCueGenes.map((value) => value.toUpperCase()),
    ...contextualCueGenes.map((value) => value.toUpperCase()),
    ...reportCueGenes.map((value) => value.toUpperCase()),
  ].filter(
    (value) =>
      !NON_MARKER_TOKENS.has(value.toUpperCase()) &&
      !/^[A-Z][A-Z0-9]*-\d+$/.test(value.toUpperCase()),
  );
  return normalized.filter(
    (value, index, values) =>
      values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index,
  );
}
