/**
 * Enrichment Engine — Client-Side Variant Enrichment Pipeline
 *
 * Ports the Python analyze() logic from convert_genome.py to TypeScript.
 * Queries all enabled sources via the SourceRegistry, then normalizes and
 * merges findings into StructuredFindings compatible with the backend's
 * Pydantic StructuredFindings model.
 *
 * TASK-012: Client-Side Enrichment Logic
 * DNA-843: Refactored to use source registry instead of hardcoded queries
 *
 * SPEC_RECOMMENDATION: Update Section 6.4 Enrichment Pipeline — now uses source registry instead of hardcoded database queries
 */

import { sourceRegistry } from "@/lib/data-sources";
import type { QueryAllResult } from "@/lib/data-sources";
import {
  matchClinVarDiseaseFindings,
  type ClinVarCandidate,
} from "./clinvar-disease-matcher";
import {
  classifyPerformanceFinding,
  curatedSnpSourceRole,
  isCuratedPharmacogenomicFinding,
} from "./performance-suite/performance-classification";

// ---------------------------------------------------------------------------
// Types — aligned with backend Pydantic models
// ---------------------------------------------------------------------------

/** Matches backend Finding model */
export interface Finding {
  rsid: string;
  gene: string;
  category: string;
  genotype: string;
  status: string;
  description: string;
  magnitude: number;
  role?: "lifestyle" | "clinical" | "pharmacogenomic";
  source?: "internal_curated_snp";
  // DNA-4892: strand-orientation metadata for Performance Suite gate
  sourceOrientation?: string;
  forwardAlleles?: string[];
  allowedForwardGenotypes?: string[];
  subLens?: "movement" | "daily_rhythm" | "supplementation";
  goalTags?: string[];
}

/** Matches backend PharmacoGenomicFinding model */
export interface PharmacoGenomicFinding {
  rsid: string;
  gene: string;
  drugs: string;
  phenotype?: string;
  genotype: string;
  annotation: string;
  level: string;
  category: string;
  sourceAssociationId?: string;
  associationDisposition?: "reportable";
  associationOutcome?:
    | "increased"
    | "decreased"
    | "unchanged"
    | "mixed"
    | "not_stated";
  role?: "lifestyle" | "clinical" | "pharmacogenomic";
  source?: "internal_curated_snp";
}

// Backward-compatible re-export removed — all consumers migrated to PharmacoGenomicFinding

/** Matches backend DiseaseFinding model */
export interface DiseaseFinding {
  rsid: string;
  gene: string;
  genotype: string;
  clinical_significance: string;
  traits: string;
  inheritance: string;
  zygosity: string;
}

/** Classification buckets for disease findings */
export interface DiseaseFindings {
  pathogenic: DiseaseFinding[];
  likely_pathogenic: DiseaseFinding[];
  carrier: DiseaseFinding[];
  risk_factor: DiseaseFinding[];
  drug_response: DiseaseFinding[];
  protective: DiseaseFinding[];
}

/** Disease statistics summary */
export interface DiseaseStats {
  total_clinvar_matches: number;
  pathogenic_count: number;
  likely_pathogenic_count: number;
  risk_factor_count: number;
  drug_response_count: number;
  protective_count: number;
  carrier_count: number;
}

/**
 * Output schema aligned with backend StructuredFindings Pydantic model.
 * This is what gets sent to /api/v1/narrate as structured_findings.
 */
export interface StructuredFindings {
  lifestyle_findings: Finding[];
  pharmacogenomic_findings: PharmacoGenomicFinding[];
  // Legacy field removed — use pharmacogenomic_findings
  disease_findings: DiseaseFindings;
  summary: {
    subject_name: string;
    total_variants_analyzed: number;
    analysis_date: string;
    source: string;
    enrichment_mode: "client" | "server";
    lifestyle_count: number;
    pharmacogenomic_count: number;
    // Legacy field removed — use pharmacogenomic_count
    disease_count: number;
    /** Immutable reference-data bundle used for this browser-local enrichment. */
    reference_bundle?: {
      bundle_id: string;
      sequence: number;
    };
  };
  disease_stats: DiseaseStats;
  /** Per-database load status: loaded | failed | not_found */
  database_status?: Record<string, string>;
  /** True if any reference database failed to load during enrichment */
  partial_results?: boolean;
  /** Names of databases that failed to load */
  failed_databases?: string[];
}

/** Variant info from the genome parser */
export interface VariantInfo {
  chromosome: string;
  position: string;
  genotype: string;
}

// ---------------------------------------------------------------------------
// IndexedDB annotation shapes (post-transform from database-loader.ts)
// ---------------------------------------------------------------------------

/**
 * SNP database annotations stored per-rsid.
 * Shape after transformSnpDatabase spreads the original record.
 */
interface SnpAnnotation {
  rsid: string;
  source: "snp_database";
  gene?: string;
  category?: string;
  variants?: Record<string, { status: string; desc: string; magnitude: number }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Database query interface (injected to avoid importing IndexedDB in workers)
// ---------------------------------------------------------------------------

export interface DatabaseQuerier {
  queryVariants(
    dbName: "clinvar_curated" | "pharmacogenomic_annotations" | "snp_database",
    rsids: string[],
  ): Promise<Map<string, unknown>>;
  /**
   * Optional position-prefix ClinVar scan. ClinVar is keyed by
   * "chrom:pos:ref:alt" (not rsid); callers that can scan by genome
   * position supply this so ClinVar matching uses the shared
   * alt-allele-carry matcher. IndexedDB impl: scanClinvarByPosition in
   * indexed-db.ts. DNA-4723.
   */
  scanClinvarByPosition?(
    positionKeys: Set<string>,
  ): Promise<Map<string, ClinVarCandidate>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Port of Python's confidence logic based on magnitude. */
function confidenceFromMagnitude(magnitude: number): string {
  if (magnitude >= 3) return "high";
  if (magnitude >= 2) return "moderate";
  return "low";
}

/** Reverse a 2-character genotype for complementary matching. */
function reverseGenotype(genotype: string): string {
  return genotype.length === 2 ? genotype[1] + genotype[0] : genotype;
}

/** Parse "drug1;drug2" into trimmed, non-empty drug names. */
export function parseDrugList(drugs: string): string[] {
  return drugs
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Enrichment Pipeline
// ---------------------------------------------------------------------------

/**
 * Progress callback for reporting enrichment stage progress.
 */
export type ProgressCallback = (percent: number, stage: string) => void;

/**
 * Enrich user variants against all three reference databases.
 *
 * This is the TypeScript port of convert_genome.py's analyze() function.
 * It produces StructuredFindings compatible with the backend Pydantic model.
 *
 * @param variants     Map of rsid -> VariantInfo from genome parser
 * @param databases    Query interface for IndexedDB lookups
 * @param subjectName  Optional subject name for the report
 * @param onProgress   Optional progress callback
 * @returns            StructuredFindings ready for /narrate endpoint
 */
export async function enrichVariants(
  variants: Map<string, VariantInfo>,
  databases: DatabaseQuerier,
  subjectName: string = "Unknown",
  onProgress?: ProgressCallback,
): Promise<StructuredFindings> {
  const lifestyleFindings: Finding[] = [];
  const pharmaFindings: PharmacoGenomicFinding[] = [];
  const clinicalFindings: DiseaseFinding[] = [];

  // Build position index for ClinVar matching (chrom:pos -> { rsid, genotype })
  const genomeByPosition = new Map<string, { rsid: string; genotype: string }>();
  for (const [rsid, info] of Array.from(variants)) {
    const posKey = `${info.chromosome}:${info.position}`;
    genomeByPosition.set(posKey, { rsid, genotype: info.genotype });
  }

  const allRsids = Array.from(variants.keys());

  // -------------------------------------------------------------------------
  // Stage 1: Query ALL enabled sources via the source registry
  // -------------------------------------------------------------------------
  // The registry handles parallel querying and graceful failure per source.
  // Disabled sources (via feature flags) are automatically excluded.
  onProgress?.(20, "Querying enabled data sources");

  // Query the registry — all enabled adapters run in parallel
  const registryResult: QueryAllResult = await sourceRegistry.queryAll(allRsids);
  const registryFindings = registryResult.findings;

  // Use structured per-source status from registry (Finding 6 fix)
  const enabledSources = sourceRegistry.getEnabledSources();
  const databaseStatus: Record<string, string> = { ...registryResult.sourceStatus };
  const failedDatabases: string[] = Object.entries(registryResult.sourceStatus)
    .filter(([, status]) => status === "failed")
    .map(([id]) => id);

  onProgress?.(50, "Queried " + enabledSources.length + " source(s)");

  // -------------------------------------------------------------------------
  // Stage 1b: Match against curated SNP database (lifestyle + some pharma)
  // -------------------------------------------------------------------------
  // The curated SNP database is NOT yet in the registry (it uses a different
  // query interface — keyed by rsid with variant sub-objects). Retain the
  // direct query until a SnpDatabaseAdapter is implemented.
  onProgress?.(55, "Matching curated SNPs");

  const snpResults = await databases.queryVariants("snp_database", allRsids);

  for (const [rsid, rawAnnotation] of Array.from(snpResults)) {
    const ann = rawAnnotation as SnpAnnotation;
    const userVariant = variants.get(rsid);
    if (!userVariant || !ann.variants) continue;

    const genotype = userVariant.genotype;
    const genotypeRev = reverseGenotype(genotype);
    const variantInfo = ann.variants[genotype] || ann.variants[genotypeRev];
    if (!variantInfo) continue;

    const category = ann.category || "";
    const magnitude = variantInfo.magnitude ?? 0;

    const sourceRole = curatedSnpSourceRole(rsid, category);
    const usesPharmacogenomicChannel = isCuratedPharmacogenomicFinding(
      category,
      variantInfo.desc,
    );

    if (usesPharmacogenomicChannel) {
      pharmaFindings.push({
        rsid,
        gene: ann.gene || "",
        drugs: "", // curated SNPs don't have specific drug names
        genotype,
        annotation: variantInfo.desc,
        level: confidenceFromMagnitude(magnitude) === "high" ? "1A" : "2B",
        category,
        role: sourceRole,
        source: "internal_curated_snp",
      });
    } else {
      // DNA-4892: derive strand-orientation metadata from curated forward-strand genotypes
      const allowedForwardGenotypes = Object.keys(ann.variants);
      const forwardAlleles = Array.from(
        new Set(allowedForwardGenotypes.join("").split(""))
      ).filter((c) => /[ACGT]/.test(c));
      const performanceClassification = classifyPerformanceFinding(
        category,
        variantInfo.desc,
        `${ann.gene || ""} ${rsid}`,
      );

      lifestyleFindings.push({
        rsid,
        gene: ann.gene || "",
        category,
        genotype,
        status: variantInfo.status,
        description: variantInfo.desc,
        magnitude,
        role: sourceRole,
        source: "internal_curated_snp",
        sourceOrientation: "forward",
        forwardAlleles,
        allowedForwardGenotypes,
        subLens: performanceClassification.subLens,
        goalTags: performanceClassification.goalTags,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Stage 1c: ClinVar clinical variants (position-prefix + alt-allele-carry)
  // -------------------------------------------------------------------------
  // ClinVar is keyed by "chrom:pos:ref:alt", NOT by rsid, so it cannot be
  // matched through the rsid-keyed source registry (doing so silently returns
  // ZERO findings — the latent bug this stage fixes, DNA-4723). Acquire
  // candidates by genome position, then apply the SAME alt-allele-carry
  // matcher the production worker uses (shared module, no drift).
  if (databases.scanClinvarByPosition) {
    onProgress?.(68, "Matching ClinVar variants");
    try {
      const clinvarCandidates = await databases.scanClinvarByPosition(
        new Set(genomeByPosition.keys()),
      );
      clinicalFindings.push(
        ...matchClinVarDiseaseFindings(genomeByPosition, clinvarCandidates),
      );
    } catch {
      // ClinVar scan failed — degrade gracefully, mirroring the production
      // worker: continue without disease findings and flag partial results so
      // an IndexedDB cursor/transaction error never aborts the whole analysis.
      // DNA-4723.
      databaseStatus["clinvar_curated"] = "failed";
      if (!failedDatabases.includes("clinvar_curated")) {
        failedDatabases.push("clinvar_curated");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stage 2: Normalize and merge findings from all registry sources
  // -------------------------------------------------------------------------
  onProgress?.(70, "Normalizing findings");

  // Map NormalizedFindings back to legacy typed arrays for backwards compat.
  // Consumers expecting pharmacogenomic_findings and disease_findings arrays still work.
  for (const nf of registryFindings) {
    if (nf.category === "pharmacogenomics") {
      pharmaFindings.push({
        rsid: nf.rsid,
        gene: nf.gene,
        drugs: (nf.metadata?.drugs as string) || "",
        genotype: nf.genotype,
        annotation: nf.description,
        level: evidenceLevelToEvidenceGrade(nf.evidenceLevel),
        category: (nf.metadata?.subcategory as string) || nf.category,
      });
    } else if (nf.category === "nutritional" || nf.category === "regulatory") {
      // Future sources (NIH ODS, FDA Biomarkers) — map to pharma for now
      pharmaFindings.push({
        rsid: nf.rsid,
        gene: nf.gene,
        drugs: (nf.metadata?.drugs as string) || "",
        genotype: nf.genotype,
        annotation: nf.description,
        level: evidenceLevelToEvidenceGrade(nf.evidenceLevel),
        category: nf.category,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Stage 3: Deduplicate and sort by evidence level
  // -------------------------------------------------------------------------
  onProgress?.(85, "Deduplicating results");

  // Deduplicate pharma findings by rsid + gene + drugs
  const seenPharma = new Set<string>();
  const dedupedPharma: PharmacoGenomicFinding[] = [];
  // Sort by evidence level (1A > 1B > 2A > 2B > ...) before dedup so
  // the highest-evidence version of a duplicate wins.
  pharmaFindings.sort((a, b) => a.level.localeCompare(b.level));
  for (const pf of pharmaFindings) {
    const key = `${pf.rsid}|${pf.gene}|${pf.drugs}|${pf.genotype}`;
    if (!seenPharma.has(key)) {
      seenPharma.add(key);
      dedupedPharma.push(pf);
    }
  }

  // Deduplicate clinical findings by rsid + classification + traits
  const seenClinical = new Set<string>();
  const dedupedClinical: DiseaseFinding[] = [];
  for (const cf of clinicalFindings) {
    const key = `${cf.rsid}|${cf.clinical_significance}|${cf.traits}`;
    if (!seenClinical.has(key)) {
      seenClinical.add(key);
      dedupedClinical.push(cf);
    }
  }

  // -------------------------------------------------------------------------
  // Build output
  // -------------------------------------------------------------------------
  onProgress?.(90, "Building results");

  // Bucket clinical findings by classification
  const diseaseFindings: DiseaseFindings = {
    pathogenic: [],
    likely_pathogenic: [],
    carrier: [],
    risk_factor: [],
    drug_response: [],
    protective: [],
  };

  for (const finding of dedupedClinical) {
    const bucket = finding.clinical_significance as keyof DiseaseFindings;
    if (bucket in diseaseFindings) {
      diseaseFindings[bucket].push(finding);
    } else {
      diseaseFindings.risk_factor.push(finding);
    }
  }

  const diseaseStats: DiseaseStats = {
    total_clinvar_matches: dedupedClinical.length,
    pathogenic_count: diseaseFindings.pathogenic.length,
    likely_pathogenic_count: diseaseFindings.likely_pathogenic.length,
    risk_factor_count: diseaseFindings.risk_factor.length,
    drug_response_count: diseaseFindings.drug_response.length,
    protective_count: diseaseFindings.protective.length,
    carrier_count: diseaseFindings.carrier.length,
  };

  const summary = {
    subject_name: subjectName,
    total_variants_analyzed: variants.size,
    analysis_date: new Date().toISOString(),
    source: "client-side",
    enrichment_mode: "client" as const,
    lifestyle_count: lifestyleFindings.length,
    pharmacogenomic_count: dedupedPharma.length,
    disease_count: dedupedClinical.length,
  };

  onProgress?.(100, "Enrichment complete");

  return {
    lifestyle_findings: lifestyleFindings,
    pharmacogenomic_findings: dedupedPharma,
    disease_findings: diseaseFindings,
    summary,
    disease_stats: diseaseStats,
    database_status: databaseStatus,
    partial_results: failedDatabases.length > 0,
    failed_databases: failedDatabases.length > 0 ? failedDatabases : undefined,
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers for NormalizedFinding -> legacy types
// ---------------------------------------------------------------------------

/** Map numeric evidence level (1-5) to evidence grade string */
function evidenceLevelToEvidenceGrade(level: number): string {
  switch (level) {
    case 1: return "1A";
    case 2: return "1B";
    case 3: return "2A";
    case 4: return "2B";
    default: return "3";
  }
}

/** Map a ClinVar-style significance string to a classification bucket */
