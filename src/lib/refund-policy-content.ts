/**
 * Refund-related copy: anchor MTS §11.8 / §11.8.1 / §11.8.2 / §11.8.3.
 * Do not duplicate policy body in customer-facing surfaces — hyperlink to /refund-policy.
 * This module is the single source of truth.
 */

export const REFUND_POLICY_VERSION = "refund-consumption-tier-v1.0.0" as const;

export const REFUND_WINDOW_HOURS = 720 as const;

/**
 * Short summary safe for inline use on customer-facing surfaces.
 * <=120 words. Hyperlinks to /refund-policy for full details.
 */
export const REFUND_POLICY_SHORT_SUMMARY =
  "Refund eligibility is based on the state of your genetic report at the time of your refund request. " +
  "Self-service refund requests may be submitted within 720 hours of purchase. " +
  "Within that window, eligibility depends on whether the report has been generated, viewed, or downloaded. " +
  "Account credit may be available as an alternative. " +
  "See the Refund Policy for full terms.";

/**
 * Full canonical policy text rendered on /refund-policy.
 * Mirrors MTS §11.8 v2.60.0-refund-policy-unification.
 * Do NOT inline this on any other surface.
 */
export const REFUND_POLICY_LONG_TEXT = `
At a glance: Refund eligibility is based on the state of your genetic report at the time of your refund request, not on elapsed time alone. The plain-language summary below is followed by the precise policy.

Self-service refund requests may be submitted through the refund request flow within 720 hours (30 days) after purchase. The 720-hour period is the outer self-service request window; it does not guarantee a cash refund after a report has been consumed.

Within that window, refund requests are evaluated using four consumption states:

1. Full cash refund — available when the report has not been viewed by the purchaser. This includes a report that has not been generated and a generated report that has not yet been opened.

2. Partial cash refund or account credit — available when the report has been viewed but not downloaded. The specific cash percentage and credit amount available to you are shown in the refund flow before you submit.

3. No self-service cash refund after full consumption — applies when the report has been downloaded or otherwise fully consumed. Account credit or manual review may be offered, but a cash refund is not guaranteed through self-service.

4. Manual review — applies when the purchase is outside the 720-hour self-service window, when payment or entitlement records are incomplete, when fraud or duplicate-purchase controls require review, or when a technical, billing, accessibility, or legal issue requires support handling.

When a refund or account credit is approved, online report access and Command Center access for the refunded report are revoked. Downloaded files already saved to your device remain your responsibility. Refund handling does not waive any separate privacy, deletion, billing-record, tax-record, audit-record, or security-retention rules described in our Privacy Policy and Terms.

Subscription cancellation is separate from refund eligibility. Cancelling a subscription stops future renewal charges according to the cancellation terms shown at purchase and in your account. Refund requests for a current subscription period are evaluated under the same consumption-state model.

Bank disputes and chargebacks are handled through the payment-network dispute process. To avoid duplicate processing and to reduce the chance that access is paused while a dispute is reviewed, we recommend submitting a refund request through the refund request flow before initiating a bank dispute when possible.

Nothing in this policy limits non-waivable consumer rights under applicable law. If applicable law requires a different refund, cancellation, notice, or posting rule for your jurisdiction, that law controls.
`.trim();

export const REFUND_POLICY_ROUTE = "/refund-policy" as const;
export const REFUND_REQUEST_ROUTE = "/refund" as const;
