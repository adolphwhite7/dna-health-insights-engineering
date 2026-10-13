import { describe, expect, it } from "vitest";

import { normalizeCustomerAnswerPlainText, validateCustomerAnswer } from "../validation";

describe("customer-chat customer-visible answer normalization", () => {
  it("removes paired emphasis markers without turning model links into trusted navigation", () => {
    const candidate =
      "**Practical next step:** Use [this link](https://untrusted.example) or __contact support__.";

    expect(normalizeCustomerAnswerPlainText(candidate)).toBe(
      "Practical next step: Use [this link](https://untrusted.example) or contact support.",
    );
    expect(
      validateCustomerAnswer(candidate, [
        {
          ref: "customer-safe-support-v1:how-it-works",
          kind: "CONSTITUTION",
          title: "How DNA Health Insights works",
          text: "Approved product information.",
        },
      ], "PRODUCT_SUPPORT").text,
    ).toBe("Practical next step: Use [this link](https://untrusted.example) or contact support.");
  });
});
