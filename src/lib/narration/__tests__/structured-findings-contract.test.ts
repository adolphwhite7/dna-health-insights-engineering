import { describe, expect, it } from "vitest";

import type { StructuredFindings } from "@/lib/enrichment-engine";
import {
  MAX_STRUCTURED_FINDING_COUNT,
  NarrationStructuredFindingsSchema,
  buildFreeWelcomePromptProjection,
  buildNarrationRequestPayload,
} from "@/lib/narration/structured-findings-contract";

function findingsWithDiseaseRows(count: number): StructuredFindings {
  return {
    lifestyle_findings: [],
    pharmacogenomic_findings: [],
    disease_findings: {
      pathogenic: Array.from({ length: count }, (_, index) => ({
        rsid:
          index % 12 === 0 ? `i${4_000_000 + index}` : `rs${1_000_000 + index}`,
        gene: `GENE${index}`,
        genotype: index % 2 === 0 ? "AG" : "A",
        clinical_significance: "informational",
        traits: "Synthetic provider contract fixture",
        inheritance: "not specified",
        zygosity: "not specified",
      })),
      likely_pathogenic: [],
      carrier: [],
      risk_factor: [],
      drug_response: [],
      protective: [],
    },
    summary: {
      subject_name: "Synthetic UAT",
      total_variants_analyzed: 100_000,
      analysis_date: "2026-07-13",
      source: "synthetic_23andme_v5",
      enrichment_mode: "client",
      lifestyle_count: 0,
      pharmacogenomic_count: 0,
      disease_count: count,
      reference_bundle: {
        bundle_id: "a".repeat(64),
        sequence: 7,
      },
    },
    disease_stats: {
      total_clinvar_matches: count,
      pathogenic_count: count,
      likely_pathogenic_count: 0,
      risk_factor_count: 0,
      drug_response_count: 0,
      protective_count: 0,
      carrier_count: 0,
    },
  };
}

describe("Structured Findings narration construction boundary", () => {
  it("transports all 821 eligible synthetic findings, including provider-native IDs", () => {
    const request = buildNarrationRequestPayload({
      clientReportUuid: "123e4567-e89b-42d3-a456-426614174000",
      structuredFindings: findingsWithDiseaseRows(821),
      totalVariantsAnalyzed: 100_000,
    });

    const fullRows = request.structured_findings.disease_findings?.pathogenic;
    expect(fullRows).toHaveLength(821);
    expect(JSON.stringify(fullRows)).toContain('"rsid":"i4000000"');
    expect(request.narrative_prompt_findings.summary).toMatchObject({
      narrative_finding_count: 14,
      total_available_findings: 821,
      reference_bundle: { bundle_id: "a".repeat(64), sequence: 7 },
    });
  });

  it("projects only typed DTO fields and cannot serialize browser raw-state containers", () => {
    const rawState = Object.assign(findingsWithDiseaseRows(1), {
      raw_file: new File(["synthetic raw text"], "synthetic.txt"),
      raw_text: "synthetic raw text",
      variant_map: new Map([["synthetic-marker", "AG"]]),
    });
    Object.assign(rawState.disease_findings.pathogenic[0], {
      raw_row: "synthetic-marker 1 100 AG",
    });

    const request = buildNarrationRequestPayload({
      clientReportUuid: "123e4567-e89b-42d3-a456-426614174000",
      structuredFindings: rawState,
      totalVariantsAnalyzed: 100_000,
    });
    const serialized = JSON.stringify(request);

    expect(serialized).not.toContain("raw_file");
    expect(serialized).not.toContain("raw_text");
    expect(serialized).not.toContain("variant_map");
    expect(serialized).not.toContain("raw_row");
    expect(serialized).toContain('"rsid":"i4000000"');
  });

  it("retains a bounded finding-count contract above current provider evidence", () => {
    expect(() =>
      NarrationStructuredFindingsSchema.parse(
        findingsWithDiseaseRows(MAX_STRUCTURED_FINDING_COUNT),
      ),
    ).not.toThrow();
    expect(() =>
      NarrationStructuredFindingsSchema.parse(
        findingsWithDiseaseRows(MAX_STRUCTURED_FINDING_COUNT + 1),
      ),
    ).toThrow();
  });

  it("projects exactly three lifestyle findings for free Welcome without changing the full finding set", () => {
    const structuredFindings = {
      ...findingsWithDiseaseRows(2),
      lifestyle_findings: Array.from({ length: 5 }, (_, index) => ({
        gene: `LIFE${index}`,
        annotation: `Lifestyle evidence ${index}`,
      })),
      pharmacogenomic_findings: [{ gene: "DPYD", annotation: "PGx evidence" }],
    } as StructuredFindings;

    const selectedLifestyleFindings = [
      structuredFindings.lifestyle_findings[4],
      structuredFindings.lifestyle_findings[1],
      structuredFindings.lifestyle_findings[3],
    ];
    const projected = buildFreeWelcomePromptProjection(
      structuredFindings,
      selectedLifestyleFindings,
    );

    expect(projected.lifestyle_findings).toHaveLength(3);
    expect(projected.lifestyle_findings?.map((finding) => finding.gene)).toEqual([
      "LIFE4",
      "LIFE1",
      "LIFE3",
    ]);
    expect(projected.pharmacogenomic_findings).toBeUndefined();
    expect(projected.disease_findings).toBeUndefined();
    expect(projected.summary).toMatchObject({
      narrative_finding_count: 3,
      total_available_findings: 8,
    });
    expect(structuredFindings.lifestyle_findings).toHaveLength(5);
    expect(structuredFindings.pharmacogenomic_findings).toHaveLength(1);
    expect(structuredFindings.disease_findings.pathogenic).toHaveLength(2);
  });

  it("fails the internal invariant when upstream classification yields fewer than three lifestyle findings", () => {
    const structuredFindings = {
      ...findingsWithDiseaseRows(2),
      lifestyle_findings: [
        { gene: "ACTN3", annotation: "Lifestyle evidence" },
        { gene: "AGTR1", annotation: "Lifestyle evidence" },
      ],
    } as StructuredFindings;

    expect(() => buildFreeWelcomePromptProjection(
      structuredFindings,
      structuredFindings.lifestyle_findings,
    )).toThrow(
      "Free Welcome requires exactly 3 lifestyle findings; received 2.",
    );
  });

  it("keeps supplement-only and legacy PharmGKB requests authorable", () => {
    const request = buildNarrationRequestPayload({
      clientReportUuid: "123e4567-e89b-42d3-a456-426614174000",
      structuredFindings: {
        lifestyle_findings: [],
        pharmacogenomic_findings: [],
        pharmgkb_findings: [{ gene: "DPYD", annotation: "PGx evidence" }],
        supplement_findings: [{ gene: "VDR", annotation: "Vitamin D context" }],
        supplement_interaction_findings: [
          { gene: "CYP1A2", annotation: "Caffeine context" },
        ],
        disease_findings: {},
      } as StructuredFindings,
      totalVariantsAnalyzed: 1,
    });

    expect(request.narrative_prompt_findings).toMatchObject({
      pharmgkb_findings: [{ gene: "DPYD" }],
      supplement_findings: [{ gene: "VDR" }],
      supplement_interaction_findings: [{ gene: "CYP1A2" }],
      summary: {
        narrative_finding_count: 3,
        total_available_findings: 3,
      },
    });
  });

  it("reserves supplement representation without exceeding the 40-row budget", () => {
    const rows = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) => ({
        gene: `${prefix}${index}`,
        annotation: `${prefix} evidence ${index}`,
      }));
    const request = buildNarrationRequestPayload({
      clientReportUuid: "123e4567-e89b-42d3-a456-426614174000",
      structuredFindings: {
        lifestyle_findings: rows(12, "LIFE"),
        pharmacogenomic_findings: rows(14, "PGX"),
        supplement_findings: rows(5, "SUPP"),
        supplement_interaction_findings: rows(5, "INTERACTION"),
        disease_findings: { risk_factor: rows(14, "RISK") },
      } as StructuredFindings,
      totalVariantsAnalyzed: 50,
    });
    const projected = request.narrative_prompt_findings;

    expect(projected.summary).toMatchObject({
      narrative_finding_count: 40,
      total_available_findings: 50,
    });
    expect(projected.supplement_findings).toHaveLength(1);
    expect(projected.supplement_interaction_findings).toHaveLength(1);
    expect(projected.lifestyle_findings).toHaveLength(12);
    expect(projected.pharmacogenomic_findings).toHaveLength(14);
    expect(projected.disease_findings?.risk_factor).toHaveLength(12);
  });
});
