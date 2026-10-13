/**
 * ClinVar Data Source Adapter
 *
 * Wraps the existing ClinVar database loading (database-loader.ts) and
 * query logic (enrichment-engine.ts Stage 3) behind the DataSourceAdapter
 * interface. This adapter does NOT rewrite existing functionality — it
 * delegates to the proven loader and IndexedDB query paths.
 *
 * JIRA: DNA-830
 */

import type {
  DataSourceAdapter,
  NormalizedFinding,
  SourceConfig,
  EvidenceLevel,
} from "./types";

import {
  queryVariants,
  type VariantAnnotation,
} from "../indexed-db";

import { loadSingleDatabase, type ProgressCallback } from "../database-loader";

// ─── Helpers ───

/**
 * Map ClinVar clinical_significance strings to an evidence level.
 * This is the project's mapping from significance labels; those labels alone
 * do not establish ClinVar review status or expert-panel review.
 */
function clinvarEvidenceLevel(significance: string): EvidenceLevel {
  const sig = significance.toLowerCase();
  if (sig.includes("pathogenic") && !sig.includes("likely")) return 1;
  if (sig.includes("likely") && sig.includes("pathogenic")) return 2;
  if (sig.includes("drug response")) return 2;
  if (sig.includes("protective")) return 3;
  if (sig.includes("risk factor")) return 3;
  return 4;
}

// ─── Adapter ───

export class ClinVarAdapter implements DataSourceAdapter {
  config: SourceConfig;

  /** Optional progress callback forwarded to the underlying loader */
  private onProgress?: ProgressCallback;
  private loaded = false;

  constructor(onProgress?: ProgressCallback) {
    this.onProgress = onProgress;
    this.config = {
      id: "clinvar",
      name: "Clinical Variant Database",
      enabled: true,
      category: "clinical",
      license: "public_domain",
      attribution: "ClinVar (NIH/NCBI)",
      version: "unknown",
      lastUpdated: new Date().toISOString().slice(0, 10),
    };
  }

  /**
   * Initialize the adapter by loading the ClinVar database into IndexedDB.
   * Delegates entirely to the existing loadSingleDatabase function.
   */
  async initialize(): Promise<void> {
    // The existing loader expects a DatabaseManifestEntry shape.
    // We replicate the constant here to avoid exporting internals.
    const entry = {
      name: "clinvar_curated" as const,
      url: "/databases/clinvar_curated.json.gz",
      gzipped: true,
    };

    await loadSingleDatabase(entry, this.onProgress);
    this.loaded = true;
  }

  /**
   * Query ClinVar for the given rsIDs and return NormalizedFindings.
   *
   * ClinVar stores entries keyed by "chrom:pos:ref:alt", not by rsID.
   * The rsids parameter here is expected to contain position-based keys
   * (e.g., "1:12345:A:G") matching the ClinVar key format, consistent
   * with how the enrichment engine Stage 3 already queries ClinVar.
   *
   * For callers that only have rsIDs without position info, the
   * enrichment engine's position-index approach should be used instead.
   */
  async query(rsids: string[]): Promise<NormalizedFinding[]> {
    if (rsids.length === 0) return [];

    const results = await queryVariants("clinvar_curated", rsids);
    const findings: NormalizedFinding[] = [];

    for (const [key, raw] of Array.from(results)) {
      const ann = raw as VariantAnnotation & {
        gene?: string;
        significance?: string;
        description?: string;
      };

      const significance = ann.significance || "uncertain significance";
      const gene = ann.gene || "unknown";

      // Extract rsid-like identifier from ClinVar's chrom:pos:ref:alt key
      const rsid = key;

      findings.push({
        id: `clinvar:${rsid}:${gene}`,
        source: "clinvar",
        category: "clinical",
        gene,
        rsid,
        genotype: "", // Genotype requires user variant context — set by caller
        significance,
        description: ann.description || "",
        evidenceLevel: clinvarEvidenceLevel(significance),
        citations: [], // ClinVar curated subset does not carry PubMed IDs
        metadata: {
          clinvarKey: key,
          rawSignificance: ann.significance,
        },
      });
    }

    return findings;
  }

  /**
   * Return the current data version string.
   * Until the database is loaded, returns "unknown".
   */
  getVersion(): string {
    return this.config.version;
  }

  /**
   * Check if the ClinVar database is loaded and available.
   * Uses the same isDatabaseLoaded check from indexed-db.ts.
   */
  isAvailable(): boolean {
    return this.loaded;
  }
}
