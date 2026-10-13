import { describe, expect, it } from "vitest";

import {
  customerActionForSubject,
  populationMarkersFrom,
  routeCustomerChatSubject,
} from "../routing";

describe("customer-chat deterministic subject routing", () => {
  it("routes personal genotype language to owned generated records", () => {
    expect(routeCustomerChatSubject("Please explain my MTHFR rs1801133 C/T genotype.")).toBe(
      "READY_FINDING",
    );
    expect(routeCustomerChatSubject("What does the genotype rs1801133 C/T in my results mean?")).toBe(
      "READY_FINDING",
    );
  });

  it("keeps non-personal genotype education separate from account record claims", () => {
    expect(routeCustomerChatSubject("What does MTHFR rs1801133 C/T generally mean?")).toBe(
      "GENERAL_GENETICS",
    );
    expect(routeCustomerChatSubject("What do my reports generally say about MTHFR?")).toBe(
      "READY_FINDING",
    );
  });

  it.each([
    "Can you help me understand what my reports say about the MC1R gene as it relates to aging?",
    "What does my generated report say about mc1r?",
    "What does mthfr mean in my report?",
    "Explain gene mc1r in my account.",
    "Please explain RS2228479 from my report.",
    "What does my C/T genotype mean?",
    "Can you explain the GG genotype in my report?",
  ])("keeps marker-bearing report questions on the ready-finding path: %s", (question) => {
    expect(routeCustomerChatSubject(question)).toBe("READY_FINDING");
  });

  it("routes marker-free report inventory separately from report-generation process questions", () => {
    expect(
      routeCustomerChatSubject(
        "Do you see reports generated on my account, and can you tell me what genes those reports cover?",
      ),
    ).toBe("DELIVERED_REPORT");
    expect(routeCustomerChatSubject("What reports are available in my account?")).toBe(
      "DELIVERED_REPORT",
    );
    expect(
      routeCustomerChatSubject(
        "DO YOU SEE REPORTS GENERATED ON MY ACCOUNT, AND CAN YOU TELL ME WHAT GENES THOSE REPORTS COVER?",
      ),
    ).toBe("DELIVERED_REPORT");
    expect(routeCustomerChatSubject("WHICH REPORTS HAVE BEEN GENERATED?")).toBe(
      "DELIVERED_REPORT",
    );
    expect(routeCustomerChatSubject("How are reports generated?")).toBe("PRODUCT_SUPPORT");
  });

  it("extracts constrained markers without treating ordinary words as genes", () => {
    expect(populationMarkersFrom("Explain gene mc1r and RS2228479 from my report.")).toEqual([
      "rs2228479",
      "MC1R",
    ]);
    expect(
      populationMarkersFrom(
        "Do you see reports generated on my account and understand what those reports cover?",
      ),
    ).toEqual([]);
    expect(populationMarkersFrom("DNA API USA HELP REPORTS UNDERSTAND AGING")).toEqual([]);
    expect(populationMarkersFrom("Can you help explain the gene result in my account?")).toEqual(
      [],
    );
    expect(populationMarkersFrom("WHAT DOES MTHFR MEAN IN MY REPORT?")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("REPORT SAYS MTHFR")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("REPORT SAYS RESULTS")).toEqual([]);
    expect(
      populationMarkersFrom("CAN YOU HELP EXPLAIN THE GENE RESULT IN MY ACCOUNT?"),
    ).toEqual([]);
    expect(
      populationMarkersFrom(
        "DO YOU SEE REPORTS GENERATED ON MY ACCOUNT, AND CAN YOU TELL ME WHAT GENES THOSE REPORTS COVER?",
      ),
    ).toEqual([]);
    expect(populationMarkersFrom("WHICH REPORTS HAVE BEEN GENERATED?")).toEqual([]);
    expect(populationMarkersFrom("What does vitamin mean?")).toEqual([]);
    expect(populationMarkersFrom("What does health mean?")).toEqual([]);
    expect(populationMarkersFrom("What does skin mean?")).toEqual([]);
    expect(populationMarkersFrom("What does MTHFR mean?")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("What does MC1R-associated mean?")).toEqual(["MC1R"]);
    expect(populationMarkersFrom("What does MC1R-2 mean?")).toEqual([]);
    expect(populationMarkersFrom("What does mthfr mean in my report?")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("What does mthfr mean in my reports?")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("What does my MTHFR genotype mean?")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("What does my mthfr genotype mean?")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("My MTHFR report says I have a variant.")).toEqual(["MTHFR"]);
    expect(populationMarkersFrom("What does skin mean in my report?")).toEqual([]);
    expect(populationMarkersFrom("What does the gene health mean?")).toEqual([]);
    expect(populationMarkersFrom("Explain the variant vitamin.")).toEqual([]);
    expect(populationMarkersFrom("Version2 explains the report response.")).toEqual([]);
    expect(populationMarkersFrom("Explain gene function and variant response.")).toEqual([]);
    expect(populationMarkersFrom("What GENES do those reports cover?")).toEqual([]);
    expect(populationMarkersFrom("Explain the VARIANTS and FINDINGS in my report.")).toEqual([]);
    expect(populationMarkersFrom("What GENOTYPES and MARKERS are in my report?")).toEqual([]);
    expect(populationMarkersFrom("What does my C/T genotype mean?")).toEqual(["C/T"]);
    expect(populationMarkersFrom("What does my C|T genotype mean?")).toEqual(["C/T"]);
    expect(populationMarkersFrom("My genotype is GG.")).toEqual(["GG"]);
    expect(
      populationMarkersFrom("Explain my generated report 123e4567-e89b-12d3-a456-426614174000."),
    ).toEqual([]);
  });

  it("keeps natural gene and medical-genotype wording on the current-membership path", () => {
    expect(routeCustomerChatSubject("What does my MTHFR genotype mean?")).toBe("READY_FINDING");
    expect(routeCustomerChatSubject("What does my mthfr genotype mean?")).toBe("READY_FINDING");
    expect(routeCustomerChatSubject("What does MC1R-associated mean?")).toBe("READY_FINDING");
    expect(routeCustomerChatSubject("My MTHFR report says I have a variant.")).toBe(
      "READY_FINDING",
    );
    expect(routeCustomerChatSubject("REPORT SAYS MTHFR")).toBe("READY_FINDING");
    expect(routeCustomerChatSubject("How much should I take based on my MTHFR genotype?")).toBe(
      "MEDICAL_OR_DOSING",
    );
  });

  it.each([
    "How long are my chat transcripts available?",
    "Where is my conversation history stored?",
    "Are chat conversations used for model training?",
    "Do you use my chats to train models?",
    "Do you train on my chat history?",
    "What is the retention period for chat?",
    "How long is my chat history kept?",
    "How long are my messages retained?",
    "Are my chat transcripts available?",
    "Do you keep my chat history?",
    "When does my conversation history expire?",
    "How many days can I view my messages?",
    "For how many days can I see my chat history?",
    "Can I view old conversations?",
    "How long can I access my transcripts?",
    "How long can I view my chat history?",
    "How long can I see my conversations?",
  ])("routes transcript privacy questions to the approved retention source: %s", (question) => {
    expect(routeCustomerChatSubject(question)).toBe("LEGAL_OR_PRIVACY");
  });

  it("does not treat an ordinary conversational phrase as a retention question", () => {
    expect(routeCustomerChatSubject("Can we continue this conversation?")).toBe("OUT_OF_SCOPE");
    expect(routeCustomerChatSubject("Can we keep this conversation going?")).toBe("OUT_OF_SCOPE");
    expect(routeCustomerChatSubject("How long does chat take to respond?")).toBe("OUT_OF_SCOPE");
    expect(routeCustomerChatSubject("Is chat available right now?")).toBe("OUT_OF_SCOPE");
    expect(routeCustomerChatSubject("How do I train for a difficult conversation?")).toBe(
      "OUT_OF_SCOPE",
    );
    expect(routeCustomerChatSubject("Can chat access an old report?")).not.toBe("LEGAL_OR_PRIVACY");
    expect(routeCustomerChatSubject("Can I open an old generated report in chat?")).toBe(
      "DELIVERED_REPORT",
    );
    expect(routeCustomerChatSubject("For how long does chat take to respond?")).toBe("OUT_OF_SCOPE");
    expect(routeCustomerChatSubject("For how long do conversations take to load?")).toBe(
      "OUT_OF_SCOPE",
    );
    expect(routeCustomerChatSubject("For how long do my conversations take to load?")).toBe(
      "OUT_OF_SCOPE",
    );
    expect(routeCustomerChatSubject("For how long do genetic messages last in a cell?")).toBe(
      "GENERAL_GENETICS",
    );
  });

  it("routes the production refund-terms wording to the canonical billing source", () => {
    expect(routeCustomerChatSubject("What are your refund terms?")).toBe("BILLING_POLICY");
    expect(customerActionForSubject("BILLING_POLICY", "What are your refund terms?")).toBeNull();
  });

  it.each([
    "How much does it cost?",
    "What are your prices?",
    "What payment methods do you accept?",
    "Do you accept credit cards?",
    "How much is the service?",
    "How much is it?",
    "What do your plans cost?",
    "How much do plans cost?",
    "Do you offer refunds?",
    "How do refunds work?",
    "What is your refund window?",
    "Can you explain your refund process?",
    "What plans do you offer?",
  ])("routes general billing policy to the canonical billing source without a contact action: %s", (question) => {
    const subject = routeCustomerChatSubject(question);
    expect(subject).toBe("BILLING_POLICY");
    expect(customerActionForSubject(subject, question)).toBeNull();
  });

  it.each([
    "I want you to provide refunds for my order.",
    "Please provide refunds for this purchase.",
  ])("treats a customer-specific refund request as a support handoff: %s", (question) => {
    const subject = routeCustomerChatSubject(question);
    expect(subject).toBe("BILLING_DISPUTE");
    expect(customerActionForSubject(subject, question)).toBe("CONTACT_FORM");
  });

  it.each([
    ["OUT_OF_SCOPE", "How do I change my email address?"],
    ["PRODUCT_SUPPORT", "How can I update the email on my account?"],
    ["PRODUCT_SUPPORT", "Can someone help with my account?"],
    ["PRODUCT_SUPPORT", "How do I close my account?"],
    ["PRODUCT_SUPPORT", "How do I delete my account?"],
    ["PRODUCT_SUPPORT", "Can you change the email address associated with my account?"],
    ["PRODUCT_SUPPORT", "Can the email address on my account be updated?"],
    ["PRODUCT_SUPPORT", "My account email is wrong."],
    ["OUT_OF_SCOPE", "How do I change my phone number?"],
    ["OUT_OF_SCOPE", "My phone number is wrong."],
    ["BILLING_POLICY", "Can I update my credit card?"],
    ["BILLING_POLICY", "Can my credit card be updated?"],
    ["BILLING_POLICY", "My credit card has expired."],
    ["PRODUCT_SUPPORT", "Where are my account settings?"],
    ["PRODUCT_SUPPORT", "I need help changing billing details on my account."],
    ["PRODUCT_SUPPORT", "How do I contact support?"],
    ["PRODUCT_SUPPORT", "I can't sign in."],
    ["PRODUCT_SUPPORT", "I need help signing in."],
    ["PRODUCT_SUPPORT", "Help me log in."],
    ["PRODUCT_SUPPORT", "I cannot access my account."],
    ["PRODUCT_SUPPORT", "I’m locked out of my account."],
    ["BILLING_POLICY", "How do I upgrade my subscription?"],
    ["OUT_OF_SCOPE", "How do I downgrade my plan?"],
    ["OUT_OF_SCOPE", "I want to change my plan."],
    ["OUT_OF_SCOPE", "Can I switch subscriptions?"],
    ["BILLING_POLICY", "Please cancel the subscription."],
    ["BILLING_POLICY", "My subscription is inactive."],
    ["BILLING_POLICY", "Why was my subscription cancelled?"],
    ["BILLING_POLICY", "My subscription expired."],
    ["BILLING_DISPUTE", "Where is my refund?"],
    ["TECHNICAL_FAILURE", "My report will not load."],
    ["ACCOUNT_INTEGRITY", "That is not my report."],
  ] as const)("attaches the closed contact-form action for %s support: %s", (subject, question) => {
    const routedSubject = routeCustomerChatSubject(question);
    expect(routedSubject).toBe(subject);
    expect(customerActionForSubject(routedSubject, question)).toBe("CONTACT_FORM");
  });

  it("does not attach support navigation to answerable finding or general questions", () => {
    expect(customerActionForSubject("READY_FINDING", "Explain my MTHFR finding.")).toBeNull();
    expect(customerActionForSubject("GENERAL_GENETICS", "What does MTHFR generally mean?")).toBeNull();
    expect(customerActionForSubject("PRODUCT_SUPPORT", "How does DNA Health Insights work?")).toBeNull();
    expect(customerActionForSubject("PRODUCT_SUPPORT", "How does my account work?")).toBeNull();
    expect(customerActionForSubject("GENERAL_GENETICS", "Can you help explain my MTHFR result?")).toBeNull();
    expect(customerActionForSubject("OUT_OF_SCOPE", "What is the weather today?")).toBeNull();
    expect(
      customerActionForSubject("BILLING_POLICY", "How does my subscription work?"),
    ).toBeNull();
  });

  it.each([
    "Can you help explain the gene result in my account?",
    "Can you update me on what the gene result in my account means?",
  ])("does not add a contact action to a generated-finding explanation: %s", (question) => {
    const subject = routeCustomerChatSubject(question);
    expect(subject).toBe("READY_FINDING");
    expect(customerActionForSubject(subject, question)).toBeNull();
  });

  it.each([
    "Can you help me understand how my account works?",
    "Can you help explain how the service works for my account?",
    "Can you update me on how my account works?",
    "How does the service manage my account?",
  ])("keeps a general product explanation answerable without a contact action: %s", (question) => {
    const subject = routeCustomerChatSubject(question);
    expect(subject).toBe("PRODUCT_SUPPORT");
    expect(customerActionForSubject(subject, question)).toBeNull();
  });

  it.each([
    "What is the biological cost of this genetic variant?",
    "What is the metabolic cost associated with this gene?",
    "How much is this gene expressed?",
    "How much is this genetic variant associated with performance?",
  ])("does not confuse a biological use of cost with billing: %s", (question) => {
    expect(routeCustomerChatSubject(question)).toBe("GENERAL_GENETICS");
  });
});
