import type { ApprovedModel } from "@/lib/model-config";

export const CUSTOMER_CHAT_ACTIONS = [
  "CHAT_MESSAGE",
  "START_CONVERSATION",
  "LIST_TRANSCRIPTS",
  "VIEW_TRANSCRIPT",
] as const;

export type CustomerChatAction = (typeof CUSTOMER_CHAT_ACTIONS)[number];
export type CustomerChatAudienceMode = "OFF" | "CUSTOMER";

export type CustomerChatRequest =
  | {
      action: "CHAT_MESSAGE";
      idempotencyKey: string;
      conversationRef?: string | null;
      message: string;
    }
  | { action: "START_CONVERSATION"; idempotencyKey: string }
  | { action: "LIST_TRANSCRIPTS"; cursor?: string | null; limit?: number }
  | {
      action: "VIEW_TRANSCRIPT";
      conversationRef: string;
      cursor?: string | null;
      limit?: number;
    };

export interface CustomerChatActor {
  id: string;
  email: string;
  emailVerified: boolean;
  /** Transient known account identity values used only for provider-boundary redaction. */
  identityRedactions: string[];
}

export interface CustomerChatGeography {
  countryCode: string;
  regionCode: string;
}

export interface CustomerChatCapabilities {
  canStart: boolean;
  canSend: boolean;
  canRead: boolean;
}

export interface CustomerChatPolicyProjection {
  retentionPolicyVersion: "OWNER_UAT_7_DAY_V1";
  retentionLabel: "7 days";
  providerRetentionLabel: "up to 30 days";
}

export interface ConversationProjection {
  conversationRef: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type CustomerChatMessageAction = "CONTACT_FORM";

export interface VisibleMessage {
  messageRef: string;
  role: "CUSTOMER" | "ASSISTANT";
  body: string;
  ordinal: number;
  createdAt: string;
  /** Closed, server-owned customer action. The client maps it to a fixed route. */
  customerAction: CustomerChatMessageAction | null;
}

export interface CustomerChatSuccessBase {
  ok: true;
  action: CustomerChatAction;
  capabilities: CustomerChatCapabilities;
  policy: CustomerChatPolicyProjection;
}

export type CustomerChatSuccess =
  | (CustomerChatSuccessBase & {
      action: "START_CONVERSATION";
      conversation: ConversationProjection;
    })
  | (CustomerChatSuccessBase & {
      action: "LIST_TRANSCRIPTS";
      conversations: ConversationProjection[];
      nextCursor: string | null;
    })
  | (CustomerChatSuccessBase & {
      action: "VIEW_TRANSCRIPT";
      conversation: ConversationProjection;
      messages: VisibleMessage[];
      nextCursor: string | null;
    })
  | (CustomerChatSuccessBase & {
      action: "CHAT_MESSAGE";
      conversationRef: string;
      turnRef: string;
      message: VisibleMessage;
      replayed: boolean;
      supportRequest?: { reference: string } | null;
    });

export interface CustomerChatFailure {
  ok: false;
  error: {
    code: CustomerChatErrorCode;
    message: string;
    retryable: boolean;
    resetAt?: string;
    incidentReference?: string;
  };
  capabilities?: CustomerChatCapabilities;
}

export type CustomerChatErrorCode =
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "AUDIENCE_DENIED"
  | "GEOGRAPHY_UNAVAILABLE"
  | "GEOGRAPHY_UNSUPPORTED"
  | "INVALID_REQUEST"
  | "PROHIBITED_INPUT"
  | "IDEMPOTENCY_CONFLICT"
  | "TURN_IN_PROGRESS"
  | "QUOTA_EXCEEDED"
  | "CONVERSATION_UNAVAILABLE"
  | "SOURCE_UNAVAILABLE"
  | "PROVIDER_OUTCOME_UNKNOWN"
  | "CHAT_TEMPORARILY_UNAVAILABLE";

export class CustomerChatError extends Error {
  constructor(
    readonly code: CustomerChatErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
    readonly incidentReference?: string,
    readonly resetAt?: string,
  ) {
    super(message);
    this.name = "CustomerChatError";
  }
}

export type SubjectClass =
  | "PRODUCT_SUPPORT"
  | "BILLING_POLICY"
  | "BILLING_DISPUTE"
  | "TECHNICAL_FAILURE"
  | "GENERAL_GENETICS"
  | "DELIVERED_REPORT"
  | "READY_FINDING"
  | "VISIBLE_NOT_GENERATED"
  | "MEDICAL_OR_DOSING"
  | "LEGAL_OR_PRIVACY"
  | "IMMINENT_DANGER"
  | "AMBIGUOUS_DISTRESS"
  | "ACCOUNT_INTEGRITY"
  | "PROHIBITED_INPUT"
  | "OUT_OF_SCOPE";

export type SourceKind =
  | "CONSTITUTION"
  | "GENERAL_GENETICS"
  | "DELIVERED_REPORT"
  | "COMMAND_CENTER_FINDING"
  | "PERFORMANCE_SUITE_FINDING"
  | "SUPPLEMENT_FINDING";

export interface ApprovedSourceExcerpt {
  ref: string;
  kind: SourceKind;
  title: string;
  text: string;
}

export type GeneratedRecordState =
  | "EXISTING_GENERATED_RECORD"
  | "NO_GENERATED_RECORD"
  | "FOREIGN_OR_INVALID_RECORD";

export interface ApprovedSourceResolution {
  sources: ApprovedSourceExcerpt[];
  generatedRecordState: GeneratedRecordState;
  /** Transient subject names excluded from source excerpts and scrubbed before provider transfer. */
  identityRedactions: string[];
}

export interface ProviderCallInput {
  question: string;
  recentMessages: VisibleMessage[];
  sources: ApprovedSourceExcerpt[];
  subject: SubjectClass;
  identityRedactions: string[];
  model: ApprovedModel;
  constitutionVersion: string;
}

export interface ProviderCallResult {
  requestId: string;
  text: string;
  model: ApprovedModel;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  responseDigest: string;
}

export interface AdmissionResult {
  status: "ACCEPTED" | "REPLAY" | "CONFLICT" | "IN_PROGRESS";
  conversationId: string;
  turnId: string;
  customerMessageId: string | null;
  terminalMessage: VisibleMessage | null;
  expiresAt: string;
  replayed: boolean;
  persistedState: string;
  terminalEffectId: string | null;
}

export interface ProviderReservation {
  status: "RESERVED" | "REPLAY_SETTLED" | "IN_PROGRESS" | "QUOTA_EXCEEDED" | "UNKNOWN";
  effectId: string;
  leaseToken: string;
  settledResult: ProviderCallResult | null;
}

export interface ReleaseResult {
  effectId: string;
  message: VisibleMessage;
  replayed: boolean;
}

export interface SupportHandoffResult {
  effectId: string;
  reference: string;
  replayed: boolean;
}

export interface ControlCompletionResult {
  effectId: string;
  replayed: boolean;
}

export interface NodeReceiptInput {
  ownerId: string;
  turnId: string;
  conversationId: string | null;
  nodeName: CustomerChatNodeName;
  nodeAttempt: number;
  parentReceiptId: string | null;
  checkpointGeneration: number;
  executionMode: "NORMAL" | "REPLAY" | "RECOVERY";
  action: CustomerChatAction;
  decisionCode: string;
  reasonCode: string;
  effectState: string;
  recoveryPhase: string;
  nextAction: string;
  messageId?: string | null;
  effectId?: string | null;
}

export const CUSTOMER_CHAT_NODE_NAMES = [
  "admit_turn",
  "route_turn",
  "resolve_sources",
  "authorize_provider",
  "call_provider",
  "settle_provider_usage",
  "persist_handoff",
  "validate_and_release",
] as const;

export type CustomerChatNodeName = (typeof CUSTOMER_CHAT_NODE_NAMES)[number];

export interface StaffHandoffProjection {
  schemaVersion: "customer_chat_handoff_v1";
  category: "your-report" | "billing" | "technical" | "privacy" | "product" | "other";
  affectedSurface: string;
  issueClass: string;
  failureStage: string;
  recordKind: string;
  customerVisibleState: string;
  populationMarker: string | null;
  buildVersion: string;
  occurredAt: string;
  conversationRef: string;
  turnRef: string;
  ownedRecordRef: string | null;
  incidentRef: string | null;
  submitterEmail: string;
  submitterEmailHmac: string;
  submitterName?: string;
}

export interface ProviderHandoffProjection {
  schemaVersion: "customer_chat_handoff_v1";
  category: StaffHandoffProjection["category"];
  subtopic: string;
  subject: string;
  issueClass: string;
  failureStage: string;
  recordKind: string;
  customerVisibleState: string;
  populationMarker: string | null;
  supportGuidance: string;
}
