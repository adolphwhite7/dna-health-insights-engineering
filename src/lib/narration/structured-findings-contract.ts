import { z } from "zod";

import type { StructuredFindings } from "@/lib/enrichment-engine";
import { assertFreeWelcomeFindingCount } from "@/lib/free-welcome-contract";

export const MAX_STRING_FIELD_LENGTH = 1000;
export const MAX_ANNOTATION_FIELD_LENGTH = 16 * 1024;
export const MAX_STRUCTURED_FINDING_COUNT = 5000;
export const MAX_NARRATIVE_FINDINGS = 40;

export const PROVIDER_MARKER_ID_PATTERN = /^(?:rs|i)\d+$/i;
export const STRUCTURED_GENOTYPE_PATTERN =
  /^(?:[ACGTDI]{1,32}(?:[\/|][ACGTDI]{1,32})?|--?|\.\.?|0{1,2}|N{1,2})$/i;
export const CHROMOSOME_POSITION_PATTERN =
  /^(?:chr)?(?:MT|[0-9]{1,2}|[XYM]):\d+$/i;

const boundedString = z.string().max(MAX_STRING_FIELD_LENGTH);
const optionalBoundedString = boundedString.optional();
const markerIdSchema = z
  .string()
  .max(64)
  .regex(PROVIDER_MARKER_ID_PATTERN)
  .optional();
const genotypeSchema = z
  .string()
  .max(65)
  .regex(STRUCTURED_GENOTYPE_PATTERN)
  .optional();
const chromosomePositionSchema = z
  .string()
  .max(64)
  .regex(CHROMOSOME_POSITION_PATTERN)
  .optional();
const alleleSchema = z
  .string()
  .max(32)
  .regex(/^[ACGTDI]{1,32}$/i);
const alleleArraySchema = z.array(alleleSchema).max(4).optional();
const genotypeArraySchema = z
  .array(z.string().max(65).regex(STRUCTURED_GENOTYPE_PATTERN))
  .max(16)
  .optional();
const orientationSchema = z
  .string()
  .max(16)
  .regex(/^(?:forward|reverse|plus|minus|\+|-)$/i)
  .optional();

export const NarrationFindingRecordSchema = z
  .object({
    id: optionalBoundedString,
    gene: optionalBoundedString,
    gene_name: optionalBoundedString,
    symbol: optionalBoundedString,
    variant_label: optionalBoundedString,
    finding_label: optionalBoundedString,
    label: optionalBoundedString,
    title: optionalBoundedString,
    name: optionalBoundedString,
    condition: optionalBoundedString,
    condition_definition: optionalBoundedString,
    conditionDefinition: optionalBoundedString,
    condition_characteristics: optionalBoundedString,
    conditionCharacteristics: optionalBoundedString,
    condition_manifestations: optionalBoundedString,
    conditionManifestations: optionalBoundedString,
    condition_symptoms: optionalBoundedString,
    conditionSymptoms: optionalBoundedString,
    trait: optionalBoundedString,
    description: optionalBoundedString,
    desc: optionalBoundedString,
    text: optionalBoundedString,
    annotation: z.string().max(MAX_ANNOTATION_FIELD_LENGTH).optional(),
    drugs: optionalBoundedString,
    phenotype: optionalBoundedString,
    sourceAssociationId: optionalBoundedString,
    associationDisposition: z
      .enum(["reportable", "conditional_unknown", "unclassified"])
      .optional(),
    associationOutcome: z
      .enum(["increased", "decreased", "unchanged", "mixed", "not_stated"])
      .optional(),
    traits: optionalBoundedString,
    inheritance: optionalBoundedString,
    zygosity: optionalBoundedString,
    clinical_significance: optionalBoundedString,
    significance: optionalBoundedString,
    classification: optionalBoundedString,
    category: optionalBoundedString,
    role: z
      .enum(["lifestyle", "clinical", "pharmacogenomic", "supplement"])
      .optional(),
    impact: z.union([boundedString, z.number()]).optional(),
    magnitude: z.union([boundedString, z.number()]).optional(),
    status: optionalBoundedString,
    level: optionalBoundedString,
    source: optionalBoundedString,
    evidence_source: optionalBoundedString,
    evidenceSource: optionalBoundedString,
    source_class: optionalBoundedString,
    sourceClass: optionalBoundedString,
    evidence_level: optionalBoundedString,
    evidenceLevel: optionalBoundedString,
    evidence_strength: z.union([boundedString, z.number()]).optional(),
    evidenceStrength: z.union([boundedString, z.number()]).optional(),
    citation_url: optionalBoundedString,
    citationUrl: optionalBoundedString,
    source_url: optionalBoundedString,
    sourceUrl: optionalBoundedString,
    citation_text: optionalBoundedString,
    citationText: optionalBoundedString,
    citation: optionalBoundedString,
    pubmed_ids: z.array(boundedString).max(64).optional(),
    pubmedIds: z.array(boundedString).max(64).optional(),
    pmids: z.array(boundedString).max(64).optional(),
    effect_direction: optionalBoundedString,
    effectDirection: optionalBoundedString,
    variant_effect_direction: optionalBoundedString,
    variantEffectDirection: optionalBoundedString,
    direction: optionalBoundedString,
    function_status: optionalBoundedString,
    functionStatus: optionalBoundedString,
    metabolizer: optionalBoundedString,
    metabolizer_status: optionalBoundedString,
    metabolizerStatus: optionalBoundedString,
    response: optionalBoundedString,
    rsid: markerIdSchema,
    rs_id: markerIdSchema,
    rsID: markerIdSchema,
    genotype: genotypeSchema,
    geno: genotypeSchema,
    marker_state: genotypeSchema,
    markerState: genotypeSchema,
    chrom_pos: chromosomePositionSchema,
    chromosome_position: chromosomePositionSchema,
    chromosomePosition: chromosomePositionSchema,
    chr_pos: chromosomePositionSchema,
    chrPos: chromosomePositionSchema,
    position: chromosomePositionSchema,
    pos: chromosomePositionSchema,
    sourceOrientation: orientationSchema,
    source_orientation: orientationSchema,
    providerOrientation: orientationSchema,
    provider_orientation: orientationSchema,
    strandOrientation: orientationSchema,
    strand_orientation: orientationSchema,
    forwardAlleles: alleleArraySchema,
    forward_alleles: alleleArraySchema,
    alleleVocabulary: alleleArraySchema,
    allele_vocabulary: alleleArraySchema,
    allowed_alleles: alleleArraySchema,
    alleles: alleleArraySchema,
    allowedForwardGenotypes: genotypeArraySchema,
    allowed_forward_genotypes: genotypeArraySchema,
    forwardGenotypes: genotypeArraySchema,
    forward_genotypes: genotypeArraySchema,
    subLens: optionalBoundedString,
    sub_lens: optionalBoundedString,
    pillar: optionalBoundedString,
    domain: optionalBoundedString,
    performance_pillar: optionalBoundedString,
    performance_domain: optionalBoundedString,
    goalTags: z.array(boundedString).max(6).optional(),
    goal_tags: z.array(boundedString).max(6).optional(),
    goals: z.array(boundedString).max(6).optional(),
  })
  .strip();

export type NarrationFindingRecord = z.infer<typeof NarrationFindingRecordSchema>;

const findingArraySchema = z
  .array(NarrationFindingRecordSchema)
  .max(MAX_STRUCTURED_FINDING_COUNT);

const SummarySchema = z
  .object({
    subject_name: optionalBoundedString,
    total_variants_analyzed: z.number().int().nonnegative().optional(),
    analysis_date: optionalBoundedString,
    source: optionalBoundedString,
    enrichment_mode: z.enum(["client", "server"]).optional(),
    lifestyle_count: z.number().int().nonnegative().optional(),
    pharmacogenomic_count: z.number().int().nonnegative().optional(),
    disease_count: z.number().int().nonnegative().optional(),
    reference_bundle: z
      .object({
        bundle_id: z.string().regex(/^[a-f0-9]{64}$/i),
        sequence: z.number().int().positive(),
      })
      .optional(),
    narrative_finding_count: z.number().int().nonnegative().optional(),
    total_available_findings: z.number().int().nonnegative().optional(),
    status: optionalBoundedString,
  })
  .strip();

const DiseaseStatsSchema = z
  .object({
    total_clinvar_matches: z.number().int().nonnegative().optional(),
    pathogenic_count: z.number().int().nonnegative().optional(),
    likely_pathogenic_count: z.number().int().nonnegative().optional(),
    risk_factor_count: z.number().int().nonnegative().optional(),
    drug_response_count: z.number().int().nonnegative().optional(),
    protective_count: z.number().int().nonnegative().optional(),
    carrier_count: z.number().int().nonnegative().optional(),
  })
  .strip();

function countFindingRecords(input: {
  lifestyle_findings?: unknown[];
  pharmacogenomic_findings?: unknown[];
  pharmgkb_findings?: unknown[];
  supplement_findings?: unknown[];
  supplement_interaction_findings?: unknown[];
  disease_findings?: Record<string, unknown>;
}): number {
  let count =
    (input.lifestyle_findings?.length ?? 0) +
    (input.pharmacogenomic_findings?.length ?? 0) +
    (input.pharmgkb_findings?.length ?? 0) +
    (input.supplement_findings?.length ?? 0) +
    (input.supplement_interaction_findings?.length ?? 0);

  for (const value of Object.values(input.disease_findings ?? {})) {
    count += Array.isArray(value) ? value.length : value ? 1 : 0;
  }
  return count;
}

export const NarrationStructuredFindingsSchema = z
  .object({
    lifestyle_findings: findingArraySchema.optional(),
    pharmacogenomic_findings: findingArraySchema.optional(),
    pharmgkb_findings: findingArraySchema.optional(),
    supplement_findings: findingArraySchema.optional(),
    supplement_interaction_findings: findingArraySchema.optional(),
    disease_findings: z
      .record(
        z.string().max(64),
        z.union([findingArraySchema, NarrationFindingRecordSchema]),
      )
      .optional(),
    summary: SummarySchema.optional(),
    disease_stats: DiseaseStatsSchema.optional(),
    database_status: z.record(z.string().max(64), boundedString).optional(),
    partial_results: z.boolean().optional(),
    failed_databases: z.array(boundedString).max(64).optional(),
  })
  .strip()
  .superRefine((value, context) => {
    if (countFindingRecords(value) > MAX_STRUCTURED_FINDING_COUNT) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        origin: "array",
        maximum: MAX_STRUCTURED_FINDING_COUNT,
        inclusive: true,
        message: `Structured finding count exceeds ${MAX_STRUCTURED_FINDING_COUNT}`,
      });
    }
  });

export type NarrationStructuredFindings = z.infer<
  typeof NarrationStructuredFindingsSchema
>;

export function projectStructuredFindingsForNarration(
  findings: StructuredFindings,
): NarrationStructuredFindings {
  return NarrationStructuredFindingsSchema.parse(findings);
}

function buildPromptProjection(
  findings: NarrationStructuredFindings,
): NarrationStructuredFindings {
  let remaining = MAX_NARRATIVE_FINDINGS;
  const take = (items: unknown[] | undefined, maxForBucket: number) => {
    if (!items || remaining <= 0) return [];
    const selected = items.slice(0, Math.min(maxForBucket, remaining));
    remaining -= selected.length;
    return selected;
  };

  const topUp = (
    selected: unknown[],
    items: unknown[] | undefined,
    maxForBucket: number,
  ) => [
    ...selected,
    ...take(items?.slice(selected.length), maxForBucket - selected.length),
  ];

  // Reserve one seat for every accepted non-core finding family so a valid
  // supplement- or legacy PharmGKB-only request cannot project to zero rows.
  let pharmgkbFindings = take(findings.pharmgkb_findings, 1);
  let supplementFindings = take(findings.supplement_findings, 1);
  let supplementInteractionFindings = take(
    findings.supplement_interaction_findings,
    1,
  );

  const lifestyleFindings = take(findings.lifestyle_findings, 12);
  const pharmacogenomicFindings = take(findings.pharmacogenomic_findings, 14);
  const diseaseFindings: Record<string, unknown[]> = {};
  for (const [bucket, value] of Object.entries(
    findings.disease_findings ?? {},
  )) {
    const items = Array.isArray(value) ? value : [value];
    diseaseFindings[bucket] = take(items, 14);
  }

  pharmgkbFindings = topUp(pharmgkbFindings, findings.pharmgkb_findings, 14);
  supplementFindings = topUp(
    supplementFindings,
    findings.supplement_findings,
    14,
  );
  supplementInteractionFindings = topUp(
    supplementInteractionFindings,
    findings.supplement_interaction_findings,
    14,
  );

  return NarrationStructuredFindingsSchema.parse({
    lifestyle_findings: lifestyleFindings,
    pharmacogenomic_findings: pharmacogenomicFindings,
    pharmgkb_findings: pharmgkbFindings,
    supplement_findings: supplementFindings,
    supplement_interaction_findings: supplementInteractionFindings,
    disease_findings: diseaseFindings,
    summary: {
      ...(findings.summary ?? {}),
      narrative_finding_count: countFindingRecords({
        lifestyle_findings: lifestyleFindings,
        pharmacogenomic_findings: pharmacogenomicFindings,
        pharmgkb_findings: pharmgkbFindings,
        supplement_findings: supplementFindings,
        supplement_interaction_findings: supplementInteractionFindings,
        disease_findings: diseaseFindings,
      }),
      total_available_findings: countFindingRecords(findings),
    },
    disease_stats: findings.disease_stats,
  });
}

export function buildFreeWelcomePromptProjection(
  findings: NarrationStructuredFindings,
  selectedLifestyleFindings: readonly NarrationFindingRecord[],
): NarrationStructuredFindings {
  const lifestyleFindings = [...selectedLifestyleFindings];
  assertFreeWelcomeFindingCount(lifestyleFindings.length);

  return NarrationStructuredFindingsSchema.parse({
    lifestyle_findings: lifestyleFindings,
    summary: {
      ...(findings.summary ?? {}),
      narrative_finding_count: lifestyleFindings.length,
      total_available_findings: countFindingRecords(findings),
    },
    disease_stats: findings.disease_stats,
  });
}

export function buildNarrationRequestPayload(input: {
  clientReportUuid: string;
  structuredFindings: StructuredFindings;
  totalVariantsAnalyzed: number | null;
}): {
  client_report_uuid: string;
  structured_findings: NarrationStructuredFindings;
  narrative_prompt_findings: NarrationStructuredFindings;
  total_variants_analyzed: number | null;
} {
  const structuredFindings = projectStructuredFindingsForNarration(
    input.structuredFindings,
  );
  return {
    client_report_uuid: input.clientReportUuid,
    structured_findings: structuredFindings,
    narrative_prompt_findings: buildPromptProjection(structuredFindings),
    total_variants_analyzed: input.totalVariantsAnalyzed,
  };
}
