import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { routeCustomerChatSubject } from "../routing";
import { SupabaseApprovedSourceResolver } from "../sources";

function queryResult(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order", "limit", "in", "or"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

type QueryResponse = { data: unknown; error: unknown };

function clientWith(results: Record<string, QueryResponse | QueryResponse[]>) {
  const queries: Record<string, ReturnType<typeof queryResult>[]> = {};
  const indexes: Record<string, number> = {};
  const from = vi.fn((table: string) => {
    const configured = results[table] ?? { data: [], error: null };
    const response = Array.isArray(configured)
      ? configured[Math.min(indexes[table] ?? 0, configured.length - 1)]
      : configured;
    indexes[table] = (indexes[table] ?? 0) + 1;
    const query = queryResult(response);
    (queries[table] ??= []).push(query);
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, from, queries };
}

describe("approved customer-chat source resolution", () => {
  it.each(["What is your refund policy?", "What are your refund terms?"])(
    "grounds refund questions in the canonical policy terms rather than an instruction to invent them: %s",
    async (question) => {
    const { client, from } = clientWith({});
    const resolver = new SupabaseApprovedSourceResolver(client);
    const subject = routeCustomerChatSubject(question);

    const result = await resolver.resolve(
      randomUUID(),
      question,
      subject,
    );

    expect(subject).toBe("BILLING_POLICY");
    expect(result.sources).toEqual([
      expect.objectContaining({
        kind: "CONSTITUTION",
        text: expect.stringMatching(/720 hours[\s\S]*\/refund-policy/),
      }),
    ]);
    expect(from).not.toHaveBeenCalled();
    },
  );

  it("grounds privacy answers in the bounded chat transfer and retention facts", async () => {
    const { client, from } = clientWith({});
    const resolver = new SupabaseApprovedSourceResolver(client);
    const question = "How long are my chat transcripts available?";
    const subject = routeCustomerChatSubject(question);

    const result = await resolver.resolve(
      randomUUID(),
      question,
      subject,
    );
    const text = result.sources[0]?.text ?? "";

    expect(subject).toBe("LEGAL_OR_PRIVACY");
    expect(result.sources[0]?.title).toBe("Privacy and account actions");
    expect(text).toMatch(/saved .* 7 days/i);
    expect(text).toMatch(/not used to train models/i);
    expect(text).toMatch(/up to six recent retained messages/i);
    expect(text).toMatch(/up to three directly relevant approved source excerpts/i);
    expect(text).toMatch(/Anthropic API[\s\S]*up to 30 days/i);
    expect(text).toMatch(/full genomic file[\s\S]*never accepted by chat/i);
    expect(text).toMatch(/authoritative account or support flow/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("finds a relevant generated report beyond the old latest-three window and drops zero-score reports", async () => {
    const reportIds = Array.from({ length: 4 }, () => randomUUID());
    const { client, queries } = clientWith({
      reports: {
        data: reportIds.map((id, index) => ({
          id,
          subject_name: index === 3 ? "Jane Customer" : `Unrelated report ${index}`,
          narrative_json: {},
          generated_at: `2026-08-0${index + 1}T00:00:00Z`,
        })),
        error: null,
      },
      narrative_reports: {
        data: reportIds.map((reportId, index) => ({
          id: randomUUID(),
          report_id: reportId,
          subject_name: index === 3 ? "Jane Customer" : `Unrelated report ${index}`,
          narrative_report:
            index === 3
              ? { summary: "The released report records MTHFR rs1801133 C/T." }
              : { summary: "Unrelated educational content." },
          generated_at: `2026-08-0${index + 1}T00:00:00Z`,
        })),
        error: null,
      },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "Please explain MTHFR in my generated report.",
      "DELIVERED_REPORT",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources.filter((source) => source.kind === "DELIVERED_REPORT")).toEqual([
      expect.objectContaining({
        title: "Generated Report excerpt",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    ]);
    expect(JSON.stringify(result.sources)).not.toContain("Unrelated educational content");
    expect(result.identityRedactions).toEqual(["Jane Customer"]);
    expect(queries.narrative_reports[0].limit).toHaveBeenCalledWith(12);
  });

  it("takes a bounded relevant window from a long narrative string", async () => {
    const reportId = randomUUID();
    const target = "MTHFR rs1801133 C/T appears in this released report.";
    const { client } = clientWith({
      reports: {
        data: [
          {
            id: reportId,
            subject_name: "Generated report",
            narrative_json: {},
            generated_at: "2026-08-01T00:00:00Z",
          },
        ],
        error: null,
      },
      narrative_reports: {
        data: [
          {
            id: randomUUID(),
            report_id: reportId,
            subject_name: "Generated report",
            narrative_report: `${"Earlier report context. ".repeat(220)} ${target} ${"Later context. ".repeat(50)}`,
            generated_at: "2026-08-01T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "Please explain MTHFR in my generated report.",
      "DELIVERED_REPORT",
    );
    const reportSource = result.sources.find((source) => source.kind === "DELIVERED_REPORT");

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(reportSource?.text).toContain(target);
    expect(reportSource?.text.length).toBeLessThanOrEqual(3_000);
  });

  it("classifies a zero-relevance generated-record search as NO_GENERATED_RECORD", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: {
        data: [
          {
            id: reportId,
            subject_name: "Sleep report",
            narrative_json: {},
            generated_at: "2026-08-01T00:00:00Z",
          },
        ],
        error: null,
      },
      narrative_reports: {
        data: [
          {
            id: randomUUID(),
            report_id: reportId,
            subject_name: "Sleep report",
            narrative_report: { summary: "Sleep timing educational content." },
            generated_at: "2026-08-01T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "Please explain MTHFR in my generated report.",
      "DELIVERED_REPORT",
    );

    expect(result.generatedRecordState).toBe("NO_GENERATED_RECORD");
    expect(result.sources.some((source) => source.kind === "DELIVERED_REPORT")).toBe(false);
  });

  it("classifies an explicit owner-filtered record reference with no match uniformly as foreign or invalid", async () => {
    const recordRef = randomUUID();
    const { client } = clientWith({ reports: { data: [], error: null } });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `Please explain my generated report ${recordRef}.`,
      "DELIVERED_REPORT",
    );

    expect(result.generatedRecordState).toBe("FOREIGN_OR_INVALID_RECORD");
    expect(result.sources.some((source) => source.kind === "DELIVERED_REPORT")).toBe(false);
  });

  it("fails closed instead of describing a delivered-report store error as no record", async () => {
    const { client } = clientWith({
      reports: { data: null, error: { message: "source unavailable" } },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(
        randomUUID(),
        "Please explain MTHFR in my generated report.",
        "DELIVERED_REPORT",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503, retryable: true });
  });

  it("uses an owner-scoped delivered report body when the narrative lookup succeeds with no row", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: {
        data: [{
          id: reportId,
          subject_name: "MTHFR generated report",
          narrative_json: { summary: "The delivered report records MTHFR rs1801133 C/T." },
          generated_at: "2026-08-01T00:00:00Z",
        }],
        error: null,
      },
      narrative_reports: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "Please explain MTHFR in my generated report.",
      "DELIVERED_REPORT",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toEqual([
      expect.objectContaining({
        kind: "DELIVERED_REPORT",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
      expect.objectContaining({ kind: "GENERAL_GENETICS" }),
    ]);
  });

  it("requires model-backed ready finding rows and fails closed on a finding-store error", async () => {
    const reportId = randomUUID();
    const { client, queries } = clientWith({
      reports: {
        data: [{
          id: reportId,
          subject_name: "Generated report",
          narrative_json: {},
          generated_at: "2026-08-10T00:00:00Z",
          created_at: "2026-08-10T00:00:00Z",
          report_kind: "full_report",
        }],
        error: null,
      },
      structured_findings: {
        data: [{ report_id: reportId, gene: "MTHFR", variant_label: "rs1801133 C/T" }],
        error: null,
      },
      command_center_finding_bodies: {
        data: null,
        error: { message: "finding store unavailable" },
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(
        randomUUID(),
        "Please explain my MTHFR finding.",
        "READY_FINDING",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503 });

    for (const table of [
      "command_center_finding_bodies",
      "performance_suite_finding_bodies",
      "supplement_finding_bodies",
    ]) {
      expect(queries[table][0].eq).toHaveBeenCalledWith("status", "ready");
      expect(queries[table][0].eq).toHaveBeenCalledWith("generation_mode", "model_backed");
      expect(queries[table][0].eq).toHaveBeenCalledWith("generation_in_progress", false);
    }
  });

  it.each([
    ["command_center_finding_bodies", "COMMAND_CENTER_FINDING", { finding_id: "MTHFR", stable_finding_key: "mthfr" }],
    ["performance_suite_finding_bodies", "PERFORMANCE_SUITE_FINDING", { stable_finding_key: "mthfr" }],
    ["supplement_finding_bodies", "SUPPLEMENT_FINDING", { supplement_id: "mthfr-support" }],
  ] as const)(
    "includes only an owner-scoped ready model-backed row from %s",
    async (table, expectedKind, identity) => {
      const reportId = randomUUID();
      const row = {
        id: randomUUID(),
        ...identity,
        body_json: { summary: "The generated MTHFR rs1801133 C/T explanation." },
        updated_at: "2026-08-10T00:00:00Z",
      };
      const { client, from, queries } = clientWith({
        reports: {
          data: [{
            id: reportId,
            subject_name: "Generated report",
            narrative_json: {},
            generated_at: "2026-08-10T00:00:00Z",
            created_at: "2026-08-10T00:00:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
        structured_findings: {
          data: [{ report_id: reportId, gene: "MTHFR", variant_label: "rs1801133 C/T" }],
          error: null,
        },
        command_center_finding_bodies: { data: [], error: null },
        performance_suite_finding_bodies: { data: [], error: null },
        supplement_finding_bodies: { data: [], error: null },
        [table]: { data: [row], error: null },
      });
      const ownerId = randomUUID();
      const resolver = new SupabaseApprovedSourceResolver(client);

      const result = await resolver.resolve(
        ownerId,
        "Please explain my MTHFR finding.",
        "READY_FINDING",
      );

      expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
      expect(result.sources).toContainEqual(
        expect.objectContaining({
          kind: expectedKind,
          text: expect.stringContaining("MTHFR rs1801133 C/T"),
        }),
      );
      expect(queries[table][0].eq).toHaveBeenCalledWith("user_id", ownerId);
      expect(queries[table][0].eq).toHaveBeenCalledWith("status", "ready");
      expect(queries[table][0].eq).toHaveBeenCalledWith("generation_mode", "model_backed");
      expect(queries[table][0].eq).toHaveBeenCalledWith("generation_in_progress", false);
      expect(new Set(from.mock.calls.map(([name]) => name))).toEqual(
        new Set([
          "reports",
          "narrative_reports",
          "structured_findings",
          "command_center_finding_bodies",
          "performance_suite_finding_bodies",
          "supplement_finding_bodies",
        ]),
      );
    },
  );

  it("puts current MC1R membership and its ready explanation ahead of weak report excerpts", async () => {
    const currentReportId = randomUUID();
    const weakReportIds = Array.from({ length: 3 }, () => randomUUID());
    const { client, queries } = clientWith({
      reports: [
        {
          data: weakReportIds.map((id, index) => ({
            id,
            subject_name: `Older report ${index}`,
            narrative_json: { summary: "A generated report covers general gene education and aging." },
            generated_at: `2026-07-0${index + 1}T00:00:00Z`,
          })),
          error: null,
        },
        {
          data: [{
            id: currentReportId,
            subject_name: "Jordan Example",
            narrative_json: { summary: "Current report summary without the requested marker." },
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
      ],
      narrative_reports: [
        {
          data: weakReportIds.map((reportId) => ({
            id: randomUUID(),
            report_id: reportId,
            subject_name: "Older report",
            narrative_report: {
              summary:
                reportId === weakReportIds[0]
                  ? "An older report mentions MC1R, but it is not the selected current report."
                  : "A generated report covers general gene education and aging.",
            },
            generated_at: "2026-07-01T00:00:00Z",
          })),
          error: null,
        },
        {
          data: [{
            id: randomUUID(),
            report_id: currentReportId,
            subject_name: "Jordan Example",
            narrative_report: { summary: "Current report summary without the requested marker." },
            generated_at: "2026-08-25T12:02:00Z",
          }],
          error: null,
        },
      ],
      structured_findings: {
        data: [
          { report_id: currentReportId, gene: "MC1R", variant_label: "V92M (rs2228479) GG" },
          { report_id: currentReportId, gene: "MC1R2", variant_label: "Neighboring fuzzy match" },
        ],
        error: null,
      },
      command_center_finding_bodies: {
        data: [{
          id: randomUUID(),
          finding_id: "MC1R",
          stable_finding_key: "mc1r-v92m",
          body_json: { summary: "MC1R V92M has an emerging association with visible skin aging." },
          updated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "Can you help me understand what my reports say about the MC1R gene as it relates to aging?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources[0]).toMatchObject({
      kind: "DELIVERED_REPORT",
      title: "Current generated report membership",
    });
    expect(result.sources[1]).toMatchObject({ kind: "COMMAND_CENTER_FINDING" });
    expect(JSON.stringify(result.sources)).not.toContain("general gene education and aging");
    expect(JSON.stringify(result.sources)).not.toContain("An older report mentions MC1R");
    expect(JSON.stringify(result.sources)).not.toContain("MC1R2");
    expect(result.identityRedactions).toContain("Jordan Example");
    expect(queries.reports[1].eq).toHaveBeenCalledWith("report_kind", "full_report");
    expect(queries.reports[1].order).toHaveBeenCalledWith("generated_at", { ascending: false });
    expect(queries.reports[1].order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(queries.reports[1].order).toHaveBeenCalledWith("id", { ascending: false });
  });

  it("recognizes a current-report marker followed by a natural-language hyphenated suffix", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: {
        data: [{
          report_id: reportId,
          narrative_report: { summary: "This MC1R-associated finding discusses skin aging." },
          generated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      structured_findings: { data: [], error: null },
      command_center_finding_bodies: { data: [], error: null },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my report say about MC1R?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Current generated report excerpt",
        text: expect.stringContaining("MC1R-associated"),
      }),
    );
  });

  it("does not treat a different hyphenated identifier as current-report marker proof", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: {
        data: [{
          report_id: reportId,
          narrative_report: { summary: "The report contains MC1R-2, a different identifier." },
          generated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      structured_findings: { data: [], error: null },
      command_center_finding_bodies: { data: [], error: null },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my report say about MC1R?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("NO_GENERATED_RECORD");
    expect(result.sources).not.toContainEqual(
      expect.objectContaining({ title: "Current generated report excerpt" }),
    );
  });

  it("uses a genotype-only question to retrieve the associated generated finding", async () => {
    const reportId = randomUUID();
    const { client, queries } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: {
        data: [{ report_id: reportId, gene: "MTHFR", variant_label: "rs1801133 C/T" }],
        error: null,
      },
      command_center_finding_bodies: {
        data: [{
          id: randomUUID(),
          finding_id: "fnd_mthfr_rs1801133_ct_0",
          stable_finding_key: "mthfr-rs1801133",
          body_json: {
            finding_identity: { gene: "MTHFR", variant: "rs1801133 C/T" },
            summary: "Your MTHFR rs1801133 C/T finding is ready to explain.",
          },
          updated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my mthfr genotype mean?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "COMMAND_CENTER_FINDING",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
    expect(queries.command_center_finding_bodies[0].or).toHaveBeenCalledWith(
      expect.stringContaining("MTHFR"),
    );
  });

  it("uses the associated gene to retain a ready explanation for an rsID-only question", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: {
        data: [{
          report_id: reportId,
          gene: "MC1R",
          variant_label: "MC1R finding",
          findings_json: {
            rsid: "rs2228479",
            genotype: "GG",
            internal_note: "must never reach approved source text",
          },
        }],
        error: null,
      },
      command_center_finding_bodies: {
        data: [{
          id: randomUUID(),
          finding_id: "MC1R",
          stable_finding_key: "mc1r-v92m",
          body_json: { summary: "MC1R V92M has an emerging association with visible skin aging." },
          updated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does rs2228479 mean in my report?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "COMMAND_CENTER_FINDING",
        text: expect.stringContaining("MC1R V92M"),
      }),
    );
    expect(JSON.stringify(result.sources)).not.toContain("internal_note");
    expect(JSON.stringify(result.sources)).not.toContain("must never reach");
  });

  it("retains the associated gene when the latest narrative already contains the rsID", async () => {
    const reportId = randomUUID();
    const { client, queries } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: [{ data: [], error: null }, {
        data: [{
          report_id: reportId,
          narrative_report: { summary: "Your report includes rs2228479." },
          generated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      }],
      structured_findings: {
        data: [{ report_id: reportId, gene: "MC1R", variant_label: "V92M (rs2228479) GG" }],
        error: null,
      },
      command_center_finding_bodies: {
        data: [{
          id: randomUUID(),
          finding_id: "MC1R",
          stable_finding_key: "mc1r-v92m",
          body_json: { summary: "MC1R V92M has an emerging association with visible skin aging." },
          updated_at: "2026-08-25T12:03:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does rs2228479 mean in my report?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "COMMAND_CENTER_FINDING",
        text: expect.stringContaining("MC1R V92M"),
      }),
    );
    expect(queries.structured_findings).toHaveLength(1);
    expect(queries.structured_findings[0].or).toHaveBeenCalledWith(
      expect.stringContaining("variant_label.ilike.%rs2228479%"),
    );
    expect(queries.structured_findings[0].limit).toHaveBeenCalledWith(24);
  });

  it("resolves an explicit finding UUID only after current-report membership is proved", async () => {
    const findingId = randomUUID();
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [], error: null },
        {
          data: [{
            id: reportId,
            subject_name: "Current full report",
            narrative_json: {},
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
      ],
      narrative_reports: { data: [], error: null },
      structured_findings: {
        data: [{ report_id: reportId, gene: "MTHFR", variant_label: "rs1801133 C/T" }],
        error: null,
      },
      command_center_finding_bodies: {
        data: [{
          id: findingId,
          finding_id: "MTHFR",
          stable_finding_key: "mthfr-rs1801133",
          body_json: { summary: "Your MTHFR rs1801133 C/T finding is ready to explain." },
          updated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `Please explain my MTHFR finding ${findingId}.`,
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "COMMAND_CENTER_FINDING",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
  });

  it("derives a UUID-only finding identity before proving current-report membership", async () => {
    const findingId = randomUUID();
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [], error: null },
        {
          data: [{
            id: reportId,
            subject_name: "Current full report",
            narrative_json: {},
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
      ],
      narrative_reports: { data: [], error: null },
      structured_findings: {
        data: [{ report_id: reportId, gene: "MTHFR", variant_label: "rs1801133 C/T" }],
        error: null,
      },
      command_center_finding_bodies: {
        data: [{
          id: findingId,
          finding_id: "fnd_mthfr_rs1801133_ct_0",
          stable_finding_key: "mthfr-rs1801133",
          body_json: {
            finding_identity: { gene: "MTHFR", variant: "rs1801133 C/T" },
            summary: "Your MTHFR rs1801133 C/T finding is ready to explain.",
          },
          updated_at: "2026-08-25T12:02:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `Please explain my finding ${findingId}.`,
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "COMMAND_CENTER_FINDING",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
  });

  it("fails closed when current report membership cannot be checked", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: { data: null, error: { message: "membership unavailable" } },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(randomUUID(), "What does my MC1R finding mean?", "READY_FINDING"),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503, retryable: true });
  });

  it("ignores three weak report excerpts when the current report has no requested marker", async () => {
    const currentReportId = randomUUID();
    const weakReportIds = Array.from({ length: 3 }, () => randomUUID());
    const { client, from } = clientWith({
      reports: [
        {
          data: weakReportIds.map((id) => ({
            id,
            subject_name: "Older generated report",
            narrative_json: { summary: "This generated report covers gene education and aging." },
            generated_at: "2026-07-01T00:00:00Z",
          })),
          error: null,
        },
        {
          data: [{
            id: currentReportId,
            subject_name: "Current full report",
            narrative_json: { summary: "Current report summary without that marker." },
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
      ],
      narrative_reports: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      structured_findings: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What do my reports say about BRCA9 and aging?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("NO_GENERATED_RECORD");
    expect(result.sources.every((source) => source.kind === "GENERAL_GENETICS")).toBe(true);
    expect(from).not.toHaveBeenCalledWith("command_center_finding_bodies");
  });

  it("does not use a delivered non-full report as generated marker evidence", async () => {
    const nonFullReportId = randomUUID();
    const { client, from, queries } = clientWith({
      reports: [
        {
          data: [{
            id: nonFullReportId,
            subject_name: "Older educational summary",
            narrative_json: { summary: "This educational summary mentions MC1R." },
            generated_at: "2026-08-24T12:00:00Z",
            report_kind: "educational_summary",
          }],
          error: null,
        },
        { data: [], error: null },
      ],
      narrative_reports: {
        data: [{
          id: randomUUID(),
          report_id: nonFullReportId,
          subject_name: "Older educational summary",
          narrative_report: { summary: "This educational summary mentions MC1R." },
          generated_at: "2026-08-24T12:00:00Z",
        }],
        error: null,
      },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my MC1R finding mean?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("NO_GENERATED_RECORD");
    expect(result.sources.every((source) => source.kind === "GENERAL_GENETICS")).toBe(true);
    expect(from).not.toHaveBeenCalledWith("structured_findings");
    expect(queries.reports[1].eq).toHaveBeenCalledWith("report_kind", "full_report");
    expect(from).not.toHaveBeenCalledWith("command_center_finding_bodies");
  });

  it("matches a three-letter ACGT gene symbol as a gene rather than a genotype", async () => {
    const reportId = randomUUID();
    const { client, queries } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: { data: [], error: null },
      structured_findings: {
        data: [{ report_id: reportId, gene: "AGT", variant_label: "AGT finding" }],
        error: null,
      },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my AGT gene finding mean?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Current generated report membership",
        text: expect.stringContaining("AGT"),
      }),
    );
    expect(queries.structured_findings[0].or).toHaveBeenCalledWith(
      expect.stringContaining("gene.ilike.AGT"),
    );
    expect(queries.structured_findings[0].order).toHaveBeenNthCalledWith(1, "generated_at", { ascending: false });
    expect(queries.structured_findings[0].order).toHaveBeenNthCalledWith(2, "gene", { ascending: true });
    expect(queries.structured_findings[0].order).toHaveBeenNthCalledWith(3, "variant_label", { ascending: true });
  });

  it("applies the full-report requirement to an explicit report UUID", async () => {
    const reportId = randomUUID();
    const { client, queries } = clientWith({
      reports: [{ data: [], error: null }, { data: [], error: null }],
      command_center_finding_bodies: { data: [], error: null },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `What does MC1R mean in report ${reportId}?`,
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("FOREIGN_OR_INVALID_RECORD");
    expect(queries.reports[1].eq).toHaveBeenCalledWith("report_kind", "full_report");
    expect(queries.reports[1].eq).toHaveBeenCalledWith("id", reportId);
  });

  it("does not accept a longer rsID as an exact match for the requested rsID", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: [], error: null },
      ],
      narrative_reports: { data: [], error: null },
      structured_findings: {
        data: [{
          report_id: reportId,
          gene: "MC1R",
          variant_label: "MC1R rs22284790 finding",
          findings_json: { rsid: "rs22284790", genotype: "GG" },
        }],
        error: null,
      },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does rs2228479 mean in my generated report?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("NO_GENERATED_RECORD");
    expect(JSON.stringify(result.sources)).not.toContain("rs22284790");
  });

  it.each(["C/T", "C|T", "CT genotype"])(
    "normalizes %s to the same current-report genotype identity",
    async (genotypeQuestion) => {
      const reportId = randomUUID();
      const { client, queries } = clientWith({
        reports: [{ data: [], error: null }, {
          data: [{
            id: reportId,
            subject_name: "Current full report",
            narrative_json: {},
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        }],
        narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
        structured_findings: {
          data: [{
            report_id: reportId,
            gene: "MTHFR",
            variant_label: "MTHFR finding",
            findings_json: { rs_id: "rs1801133", geno: "CT" },
          }],
          error: null,
        },
        command_center_finding_bodies: { data: [], error: null },
        performance_suite_finding_bodies: { data: [], error: null },
        supplement_finding_bodies: { data: [], error: null },
      });
      const resolver = new SupabaseApprovedSourceResolver(client);

      const result = await resolver.resolve(
        randomUUID(),
        `What does my ${genotypeQuestion} mean?`,
        "READY_FINDING",
      );

      expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
      expect(result.sources).toContainEqual(
        expect.objectContaining({
          title: "Current generated report membership",
          text: expect.stringContaining("MTHFR rs1801133 C/T"),
        }),
      );
      expect(queries.structured_findings[0].or).toHaveBeenCalledWith(
        expect.stringMatching(/findings_json->>(?:genotype|geno|marker_state|markerState)\.ilike\.(?:CT|C\/T|C\|T)/),
      );
    },
  );

  it("describes a truncated single-identity genotype search without claiming multiple matches", async () => {
    const reportId = randomUUID();
    const repeatedIdentity = {
      report_id: reportId,
      gene: "MTHFR",
      variant_label: "MTHFR finding",
      findings_json: { rsid: "rs1801133", genotype: "CT" },
    };
    const { client, queries } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: { data: Array.from({ length: 24 }, () => repeatedIdentity), error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my C/T genotype mean?",
      "READY_FINDING",
    );

    const clarification = result.sources.find(
      (source) => source.title === "Current generated report matches needing clarification",
    );
    expect(clarification?.text).toMatch(/bounded search[\s\S]*MTHFR rs1801133 C\/T[\s\S]*More matching findings may exist/i);
    expect(clarification?.text).not.toMatch(/^Multiple/i);
    expect(queries.structured_findings[0].limit).toHaveBeenCalledWith(24);
  });

  it("preserves current-report clarification when the bounded current genotype search has no exact identity", async () => {
    const reportId = randomUUID();
    const noisyRows = Array.from({ length: 24 }, (_, index) => ({
      report_id: reportId,
      gene: `GENE${index}`,
      variant_label: `Unrelated finding ${index}`,
      findings_json: { genotype: "AA" },
    }));
    const { client, queries } = clientWith({
      reports: [{ data: [], error: null }, {
        data: [{
          id: reportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }],
        error: null,
      }],
      narrative_reports: { data: [], error: null },
      structured_findings: { data: noisyRows, error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my C/T genotype mean?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Current generated report matches needing clarification",
        text: expect.stringMatching(/reached its limit[\s\S]*which gene or rsID/i),
      }),
    );
    expect(queries.reports).toHaveLength(2);
  });

  it("prefers an older exact structured identity over a current narrative-only notation match", async () => {
    const currentReportId = randomUUID();
    const olderReportId = randomUUID();
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: [{
          id: olderReportId,
          subject_name: "Earlier full report",
          narrative_json: {},
          generated_at: "2026-07-15T12:00:00Z",
          created_at: "2026-07-15T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
      ],
      narrative_reports: [
        { data: [{
          report_id: currentReportId,
          narrative_report: { summary: "C/T is a common example of genotype notation." },
          generated_at: "2026-08-25T12:02:00Z",
        }], error: null },
        { data: [], error: null },
      ],
      structured_findings: [
        { data: [], error: null },
        { data: [{
          report_id: olderReportId,
          gene: "MTHFR",
          variant_label: "MTHFR finding",
          findings_json: { rsid: "rs1801133", genotype: "CT" },
          generated_at: "2026-07-15T12:00:00Z",
        }], error: null },
      ],
      command_center_finding_bodies: { data: [], error: null },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my C/T genotype mean?",
      "READY_FINDING",
    );

    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Earlier generated report membership (2026-07-15)",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
    expect(result.sources).not.toContainEqual(
      expect.objectContaining({ title: "Current generated report excerpt" }),
    );
  });

  it("uses a distinctly labeled older delivered full report for a unique exact fallback", async () => {
    const currentReportId = randomUUID();
    const olderReportId = randomUUID();
    const historicalRow = {
      report_id: olderReportId,
      gene: "APOE",
      variant_label: "APOE finding",
      findings_json: { rsID: "rs429358", markerState: "CT" },
      generated_at: "2026-07-15T12:00:00Z",
    };
    const { client, queries } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: [{
          id: olderReportId,
          subject_name: "Earlier full report",
          narrative_json: {},
          generated_at: "2026-07-15T12:00:00Z",
          created_at: "2026-07-15T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
      ],
      narrative_reports: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
      structured_findings: [
        { data: [], error: null },
        { data: [historicalRow], error: null },
      ],
      command_center_finding_bodies: {
        data: [
          {
            id: randomUUID(),
            finding_id: "APOE",
            stable_finding_key: "apoe-rs7412",
            body_json: { summary: "A different APOE rs7412 finding is ready to explain." },
            updated_at: "2026-07-15T12:03:00Z",
          },
          {
            id: randomUUID(),
            finding_id: "APOE",
            stable_finding_key: "apoe-rs429358",
            body_json: { summary: "Your APOE rs429358 generated finding is ready to explain." },
            updated_at: "2026-07-15T12:02:00Z",
          },
        ],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does rs429358 mean in my generated reports?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Earlier generated report membership (2026-07-15)",
        text: expect.stringMatching(/earlier delivered Full Report[\s\S]*APOE rs429358 C\/T[\s\S]*does not establish.*current report/i),
      }),
    );
    expect(result.sources).toContainEqual(
      expect.objectContaining({ kind: "COMMAND_CENTER_FINDING", text: expect.stringContaining("APOE rs429358") }),
    );
    expect(JSON.stringify(result.sources)).not.toContain("rs7412");
    expect(JSON.stringify(result.sources)).not.toContain("Current generated report membership");
    expect(queries.reports[2].eq).toHaveBeenCalledWith("user_id", expect.any(String));
    expect(queries.reports[2].eq).toHaveBeenCalledWith("report_status", "delivered");
    expect(queries.reports[2].eq).toHaveBeenCalledWith("report_kind", "full_report");
    expect(queries.reports[2].order).toHaveBeenNthCalledWith(1, "generated_at", { ascending: false });
    expect(queries.reports[2].order).toHaveBeenNthCalledWith(2, "created_at", { ascending: false });
    expect(queries.reports[2].order).toHaveBeenNthCalledWith(3, "id", { ascending: false });
    expect(queries.reports[2].neq).toHaveBeenCalledWith("id", currentReportId);
    expect(queries.structured_findings[1].in).toHaveBeenCalledWith("report_id", [olderReportId]);
    expect(queries.structured_findings[1].order).toHaveBeenNthCalledWith(1, "generated_at", { ascending: false });
    expect(queries.structured_findings[1].order).toHaveBeenNthCalledWith(2, "report_id", { ascending: false });
    expect(queries.structured_findings[1].order).toHaveBeenNthCalledWith(3, "gene", { ascending: true });
    expect(queries.structured_findings[1].order).toHaveBeenNthCalledWith(4, "variant_label", { ascending: true });
    expect(queries.structured_findings[1].limit).toHaveBeenCalledWith(48);
    expect(queries.structured_findings).toHaveLength(2);
    expect(queries.reports[2].limit).toHaveBeenCalledWith(48);
  });

  it("uses historical membership for an explicit finding UUID that is absent from the current report", async () => {
    const findingId = randomUUID();
    const currentReportId = randomUUID();
    const olderReportId = randomUUID();
    const historicalRow = {
      report_id: olderReportId,
      gene: "MTHFR",
      variant_label: "MTHFR finding",
      findings_json: { rsid: "rs1801133", genotype: "CT" },
      generated_at: "2026-07-15T12:00:00Z",
    };
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: [{
          id: olderReportId,
          subject_name: "Earlier full report",
          narrative_json: {},
          generated_at: "2026-07-15T12:00:00Z",
          created_at: "2026-07-15T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
      ],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: [
        { data: [], error: null },
        { data: [historicalRow], error: null },
      ],
      command_center_finding_bodies: {
        data: [{
          id: findingId,
          finding_id: "MTHFR",
          stable_finding_key: "mthfr-rs1801133",
          body_json: { summary: "Your MTHFR rs1801133 C/T generated finding is ready to explain." },
          updated_at: "2026-07-15T12:02:00Z",
        }],
        error: null,
      },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `Please explain my generated finding ${findingId}.`,
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Earlier generated report membership (2026-07-15)",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "COMMAND_CENTER_FINDING",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
  });

  it("asks for genotype clarification when a bounded historical candidate result is truncated before an exact match", async () => {
    const currentReportId = randomUUID();
    const noisyRows = Array.from({ length: 48 }, (_, index) => ({
      report_id: randomUUID(),
      gene: `GENE${index}`,
      variant_label: "ACTG context",
      findings_json: { genotype: "ACTG" },
      generated_at: "2026-07-15T12:00:00Z",
    }));
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
      ],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: [
        { data: [], error: null },
        { data: noisyRows, error: null },
      ],
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my C/T genotype mean?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Generated report matches needing clarification",
        text: expect.stringMatching(/reached its limit[\s\S]*which gene or rsID/i),
      }),
    );
  });

  it("does not apply the 24-row current limit to one exact historical identity", async () => {
    const currentReportId = randomUUID();
    const olderReportId = randomUUID();
    const repeatedIdentity = {
      report_id: olderReportId,
      gene: "MTHFR",
      variant_label: "MTHFR finding",
      findings_json: { rsid: "rs1801133", genotype: "CT" },
      generated_at: "2026-07-15T12:00:00Z",
    };
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: [{
          id: olderReportId,
          subject_name: "Earlier full report",
          narrative_json: {},
          generated_at: "2026-07-15T12:00:00Z",
          created_at: "2026-07-15T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
      ],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: [
        { data: [], error: null },
        { data: Array.from({ length: 30 }, () => repeatedIdentity), error: null },
      ],
      command_center_finding_bodies: { data: [], error: null },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my C/T genotype mean?",
      "READY_FINDING",
    );

    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Earlier generated report membership (2026-07-15)",
        text: expect.stringContaining("MTHFR rs1801133 C/T"),
      }),
    );
    expect(result.sources).not.toContainEqual(
      expect.objectContaining({ title: "Generated report matches needing clarification" }),
    );
  });

  it("returns bounded clarification for an ambiguous older genotype without selecting a ready body", async () => {
    const currentReportId = randomUUID();
    const olderReportIds = Array.from({ length: 7 }, () => randomUUID());
    const identities = [
      ["MTHFR", "rs1801133"],
      ["APOE", "rs429358"],
      ["BRCA1", "rs799917"],
      ["TP53", "rs1042522"],
      ["NAT2", "rs1799930"],
      ["FADS1", "rs174547"],
      ["OPRM1", "rs1799971"],
    ];
    const historicalRows = identities.map(([gene, rsid], index) => ({
      report_id: olderReportIds[index],
      gene,
      variant_label: `${gene} finding`,
      findings_json: { rsid, genotype: index % 2 === 0 ? "CT" : "C/T" },
      generated_at: `2026-07-${15 - index}T12:00:00Z`,
    }));
    const { client, from } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: olderReportIds.map((id, index) => ({
          id,
          subject_name: `Earlier full report ${index}`,
          narrative_json: {},
          generated_at: `2026-07-${15 - index}T12:00:00Z`,
          created_at: `2026-07-${15 - index}T12:01:00Z`,
          report_kind: "full_report",
        })), error: null },
      ],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: [
        { data: [], error: null },
        { data: historicalRows, error: null },
      ],
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What does my C/T genotype mean?",
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        title: "Generated report matches needing clarification",
        text: expect.stringMatching(/MTHFR rs1801133 C\/T[\s\S]*APOE rs429358 C\/T[\s\S]*which gene or rsID/i),
      }),
    );
    expect(JSON.stringify(result.sources)).not.toContain("OPRM1 rs1799971");
    expect(from).not.toHaveBeenCalledWith("command_center_finding_bodies");
    expect(from).not.toHaveBeenCalledWith("performance_suite_finding_bodies");
    expect(from).not.toHaveBeenCalledWith("supplement_finding_bodies");
  });

  it("fails closed when the bounded historical identity query is unavailable", async () => {
    const currentReportId = randomUUID();
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
      ],
      narrative_reports: [{ data: [], error: null }, { data: [], error: null }],
      structured_findings: [
        { data: [], error: null },
        { data: null, error: { message: "historical membership unavailable" } },
      ],
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(randomUUID(), "What does rs999999 mean in my report?", "READY_FINDING"),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503, retryable: true });
  });

  it("fails closed when eligible historical full reports cannot be loaded", async () => {
    const currentReportId = randomUUID();
    const { client, from } = clientWith({
      reports: [
        { data: [], error: null },
        { data: [{
          id: currentReportId,
          subject_name: "Current full report",
          narrative_json: {},
          generated_at: "2026-08-25T12:00:00Z",
          created_at: "2026-08-25T12:01:00Z",
          report_kind: "full_report",
        }], error: null },
        { data: null, error: { message: "historical reports unavailable" } },
      ],
      narrative_reports: { data: [], error: null },
      structured_findings: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(randomUUID(), "What does rs999999 mean in my report?", "READY_FINDING"),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503, retryable: true });
    expect(from).not.toHaveBeenCalledWith("command_center_finding_bodies");
  });

  it("treats a valid explicit report missing the marker as absent rather than foreign", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: [
        { data: [], error: null },
        {
          data: [{
            id: reportId,
            subject_name: "Selected report",
            narrative_json: { summary: "This report does not contain the requested marker." },
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
      ],
      narrative_reports: { data: [], error: null },
      structured_findings: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `What does BRCA9 mean in report ${reportId}?`,
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("NO_GENERATED_RECORD");
    expect(result.sources.every((source) => source.kind === "GENERAL_GENETICS")).toBe(true);
  });

  it("returns bounded report context for marker-free account inventory even at zero relevance", async () => {
    const reportId = randomUUID();
    const { client } = clientWith({
      reports: {
        data: [{
          id: reportId,
          subject_name: "Generated report",
          narrative_json: { summary: "A released wellness report with several sections." },
          generated_at: "2026-08-25T12:00:00Z",
        }],
        error: null,
      },
      narrative_reports: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "Do you see reports generated on my account, and what genes do those reports cover?",
      "DELIVERED_REPORT",
    );

    expect(result.generatedRecordState).toBe("EXISTING_GENERATED_RECORD");
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        kind: "DELIVERED_REPORT",
        text: expect.stringContaining("released wellness report"),
      }),
    );
  });

  it("fails closed when report-inventory narratives cannot be read", async () => {
    const { client } = clientWith({
      reports: {
        data: [{
          id: randomUUID(),
          subject_name: "Generated report",
          narrative_json: { summary: "A legacy report snapshot." },
          generated_at: "2026-08-25T12:00:00Z",
        }],
        error: null,
      },
      narrative_reports: { data: null, error: { message: "narratives unavailable" } },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(
        randomUUID(),
        "What reports are available in my account?",
        "DELIVERED_REPORT",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503, retryable: true });
  });

  it("preserves customer-safe report identities in a multi-report inventory", async () => {
    const reportKinds = ["full_report", "educational_summary", "welcome_reading"];
    const { client, queries } = clientWith({
      reports: {
        data: reportKinds.map((report_kind, index) => ({
          id: randomUUID(),
          subject_name: "Generated report",
          narrative_json: { summary: `Available report ${index + 1}.` },
          generated_at: `2026-08-2${index + 1}T12:00:00Z`,
          report_kind,
        })),
        error: null,
      },
      narrative_reports: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      "What reports are available in my account?",
      "DELIVERED_REPORT",
    );

    expect(result.sources.map((source) => source.title)).toEqual(
      expect.arrayContaining([
        "Full Report excerpt",
        "Educational Summary excerpt",
        "Welcome Reading excerpt",
      ]),
    );
    expect(queries.reports[0].select).toHaveBeenCalledWith(
      expect.stringContaining("report_kind"),
    );
  });

  it("fails closed when the latest current-report narrative cannot be read", async () => {
    const reportId = randomUUID();
    const { client, from } = clientWith({
      reports: [
        { data: [], error: null },
        {
          data: [{
            id: reportId,
            subject_name: "Current full report",
            narrative_json: { summary: "An older snapshot mentions MC1R." },
            generated_at: "2026-08-25T12:00:00Z",
            created_at: "2026-08-25T12:01:00Z",
            report_kind: "full_report",
          }],
          error: null,
        },
      ],
      narrative_reports: { data: null, error: { message: "latest narrative unavailable" } },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    await expect(
      resolver.resolve(randomUUID(), "What does my MC1R finding mean?", "READY_FINDING"),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503, retryable: true });
    expect(from).not.toHaveBeenCalledWith("structured_findings");
  });

  it("collapses an unmatched explicit finding reference into the uniform foreign-or-invalid state", async () => {
    const recordRef = randomUUID();
    const { client } = clientWith({
      reports: { data: [], error: null },
      command_center_finding_bodies: { data: [], error: null },
      performance_suite_finding_bodies: { data: [], error: null },
      supplement_finding_bodies: { data: [], error: null },
    });
    const resolver = new SupabaseApprovedSourceResolver(client);

    const result = await resolver.resolve(
      randomUUID(),
      `Please explain my generated finding ${recordRef}.`,
      "READY_FINDING",
    );

    expect(result.generatedRecordState).toBe("FOREIGN_OR_INVALID_RECORD");
    expect(result.sources.every((source) => source.kind === "GENERAL_GENETICS")).toBe(true);
  });
});
