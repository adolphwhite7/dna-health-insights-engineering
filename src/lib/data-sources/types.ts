/**
 * Data Source Abstraction Layer — Type Definitions
 *
 * Universal types for the multi-source data pipeline. All data sources
 * (ClinVar, CPIC, FDA Biomarkers, NIH ODS, etc.) normalize their output
 * to NormalizedFinding before reaching the UI or narration layers.
 *
 * JIRA: DNA-828
 */

// ─── Governed Source & License IDs ───

/** All known data source identifiers. New sources must be added here. */
export type DataSourceId =
  | "clinvar"
  | "cpic"
  | "nih_ods"
  | "pharmgkb";

/** All known license types. New license types must be added here. */
export type LicenseId =
  | "public_domain"
  | "cc0"
  | "cc_by_sa_4"
  | "commercial_agreement_required";

// ─── Finding Categories ───

export type FindingCategory =
  | "clinical"
  | "pharmacogenomics"
  | "nutritional"
  | "regulatory"
  | "system";

// ─── Evidence Levels ───
// 1 = highest (e.g., FDA-approved labeling, CPIC Level A)
// 5 = lowest  (e.g., preliminary association, single study)

export type EvidenceLevel = 1 | 2 | 3 | 4 | 5;

// ─── The universal finding shape — all sources normalize to this ───

export interface NormalizedFinding {
  /** Unique finding ID (format: source:rsid:gene, e.g., "cpic:rs1045642:ABCB1") */
  id: string;
  /** Source identifier (e.g., "clinvar", "cpic") */
  source: string;
  /** Finding category */
  category: FindingCategory;
  /** Gene symbol (e.g., "CYP2D6", "ABCB1") */
  gene: string;
  /** Variant rsID (e.g., "rs1045642") */
  rsid: string;
  /** User's genotype (e.g., "AG", "CC") */
  genotype: string;
  /** Clinical or research significance */
  significance: string;
  /** Human-readable finding description */
  description: string;
  /** Evidence level: 1 (highest) to 5 (lowest) */
  evidenceLevel: EvidenceLevel;
  /** PubMed IDs or citation URLs */
  citations: string[];
  /** Source-specific extra data (typed per-adapter, not exposed to generic UI) */
  metadata: Record<string, unknown>;
}

// ─── Source Configuration ───

export interface SourceConfig {
  /** Unique source identifier — must match a DataSourceId value */
  id: DataSourceId | string;
  /** Display name — source-agnostic (e.g., "Clinical Variant Database") */
  name: string;
  /** Feature flag — controls whether this source is active */
  enabled: boolean;
  /** What type of data this source provides */
  category: FindingCategory;
  /** License type — governs commercial-use eligibility */
  license: LicenseId | string;
  /** Required attribution text */
  attribution: string;
  /** Current data version */
  version: string;
  /** ISO date of last data update */
  lastUpdated: string;
}

// ─── Adapter Interface ───

/**
 * The adapter interface that all data sources implement.
 * Each source (ClinVar, CPIC, FDA, etc.) provides an adapter that:
 * 1. Holds its own configuration
 * 2. Initializes any required resources (DB loads, index builds)
 * 3. Queries variants and returns NormalizedFindings
 */
export interface DataSourceAdapter {
  /** Source configuration */
  config: SourceConfig;
  /** Initialize the adapter (load data, build indices, etc.) */
  initialize(): Promise<void>;
  /** Query a list of rsIDs and return normalized findings */
  query(rsids: string[]): Promise<NormalizedFinding[]>;
  /** Return the current data version string */
  getVersion(): string;
  /** Check if the adapter's data source is available and ready */
  isAvailable(): boolean;
}
