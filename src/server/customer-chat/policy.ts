import "server-only";

import type {
  CustomerChatActor,
  CustomerChatAudienceMode,
  CustomerChatCapabilities,
  CustomerChatGeography,
  CustomerChatPolicyProjection,
} from "./types";
import { CustomerChatError } from "./types";

export const CUSTOMER_CHAT_POLICY_VERSION = "OWNER_UAT_7_DAY_V1" as const;
export const CUSTOMER_CHAT_GRAPH_VERSION = "customer-chat-langgraph-v1";
export const CUSTOMER_CHAT_CONSTITUTION_VERSION = "customer-safe-constitution-v1";
export const CUSTOMER_CHAT_MAX_MESSAGE_CHARS = 4_000;
export const CUSTOMER_CHAT_MAX_REQUEST_BYTES = 16 * 1024;
export const CUSTOMER_CHAT_MAX_CONTEXT_MESSAGES = 6;
export const CUSTOMER_CHAT_MAX_SOURCE_EXCERPTS = 3;
export const CUSTOMER_CHAT_MAX_CONTEXT_CHARS = 24_000;
export const CUSTOMER_CHAT_MAX_INPUT_TOKENS = 8_000;
export const CUSTOMER_CHAT_MAX_OUTPUT_TOKENS = 1_500;
export const CUSTOMER_CHAT_DAILY_PROVIDER_LIMIT = 20;
export const CUSTOMER_CHAT_MONTHLY_PROVIDER_LIMIT = 60;

const BLOCKED_REGIONS = new Set(["CA", "IL", "NY"]);

export const CUSTOMER_CHAT_POLICY_PROJECTION: CustomerChatPolicyProjection = {
  retentionPolicyVersion: CUSTOMER_CHAT_POLICY_VERSION,
  retentionLabel: "7 days",
  providerRetentionLabel: "up to 30 days",
};

function closedAudienceMode(value: string | undefined): CustomerChatAudienceMode {
  if (value === "CUSTOMER") return value;
  return "OFF";
}

export function customerChatAudienceMode(): CustomerChatAudienceMode {
  return closedAudienceMode(process.env.CUSTOMER_CHAT_AUDIENCE_MODE?.trim());
}

export function customerChatCapabilities(
  mode: CustomerChatAudienceMode,
): CustomerChatCapabilities {
  const enabled = mode === "CUSTOMER";
  return {
    canStart: enabled,
    canSend: enabled,
    canRead: enabled,
  };
}

export function assertAudienceAuthorized(actor: CustomerChatActor): CustomerChatAudienceMode {
  const mode = customerChatAudienceMode();
  if (mode === "OFF") {
    throw new CustomerChatError("NOT_FOUND", 404, "Not Found");
  }
  if (!actor.emailVerified) {
    throw new CustomerChatError("AUDIENCE_DENIED", 404, "Not Found");
  }
  return mode;
}

export function assertGeographyAllowed(geography: CustomerChatGeography): void {
  const country = geography.countryCode.trim().toUpperCase();
  const region = geography.regionCode.trim().toUpperCase();
  if (!country || !region) {
    throw new CustomerChatError(
      "GEOGRAPHY_UNAVAILABLE",
      451,
      "Chat is unavailable because your location could not be confirmed.",
    );
  }
  if (country !== "US" || BLOCKED_REGIONS.has(region)) {
    throw new CustomerChatError(
      "GEOGRAPHY_UNSUPPORTED",
      451,
      "Chat is not available in your location.",
    );
  }
}

export function geographyFromHeaders(headers: Headers): CustomerChatGeography {
  if (process.env.NODE_ENV !== "production") {
    const testCountry = process.env.CUSTOMER_CHAT_TEST_COUNTRY?.trim();
    const testRegion = process.env.CUSTOMER_CHAT_TEST_REGION?.trim();
    if (testCountry && testRegion) {
      return { countryCode: testCountry, regionCode: testRegion };
    }
  }
  return {
    countryCode: headers.get("x-vercel-ip-country") ?? "",
    regionCode: headers.get("x-vercel-ip-country-region") ?? "",
  };
}

export function customerChatExpiresAt(now = new Date()): string {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
}
