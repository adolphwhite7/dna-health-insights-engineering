// SPEC_RECOMMENDATION: Add NIH ODS adapter to Section 8.5 — nutritional reference data source for dosage ranges and safety profiles

/**
 * NIH Office of Dietary Supplements Data Source Adapter
 *
 * Provides supplement reference data from the NIH Office of Dietary
 * Supplements, including dosage ranges, tolerable upper intake levels,
 * and safety profiles for dietary supplements.
 *
 * Data is public domain (U.S. government work). The adapter starts
 * DISABLED in the registry and must be flag-gated until data is verified.
 *
 * JIRA: DNA-847
 */

import type {
  DataSourceAdapter,
  NormalizedFinding,
  SourceConfig,
} from "./types";

// ─── NIH ODS JSON shape (expected data file format) ───

interface NihOdsEntry {
  supplement_name: string;
  category: string;
  rda_adult: string;
  tolerable_upper_intake: string;
  key_interactions: string[];
  safety_notes: string;
  fact_sheet_url: string;
}

// ─── Data file path ───

const NIH_ODS_DATA_PATH = "/data/databases/nih_ods_reference.json";

// ─── Adapter ───

export class NihOdsAdapter implements DataSourceAdapter {
  config: SourceConfig;

  private entries: NihOdsEntry[] = [];
  /** Index: supplement name (lowercased) -> entry */
  private nameIndex: Map<string, NihOdsEntry> = new Map();
  private loaded = false;

  constructor() {
    this.config = {
      id: "nih_ods",
      name: "NIH Supplement Reference Data",
      enabled: false,
      category: "nutritional",
      license: "public_domain",
      attribution: "NIH Office of Dietary Supplements",
      version: "unknown",
      lastUpdated: new Date().toISOString().slice(0, 10),
    };
  }

  /**
   * Initialize by loading the NIH ODS reference JSON file.
   * Gracefully handles the case where the data file has not yet been
   * created — the adapter simply stays unavailable until the file
   * is present.
   */
  async initialize(): Promise<void> {
    try {
      const response = await fetch(NIH_ODS_DATA_PATH);
      if (!response.ok) {
        console.warn(
          `[NihOdsAdapter] Data file not available (${response.status}). ` +
            `Stub data file not yet created at ${NIH_ODS_DATA_PATH}.`
        );
        return;
      }

      const data: NihOdsEntry[] = await response.json();
      this.entries = data;

      // Build name index for efficient lookup
      for (const entry of data) {
        const nameKey = entry.supplement_name.toLowerCase();
        this.nameIndex.set(nameKey, entry);
      }

      this.loaded = true;
      this.config.version = `${data.length}-entries`;
      console.info(
        `[NihOdsAdapter] Loaded ${data.length} NIH ODS supplement entries.`
      );
    } catch (err) {
      console.warn(
        `[NihOdsAdapter] Failed to load NIH ODS data: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Query for supplement reference data.
   *
   * TODO: For nutritional sources, the query pattern is fundamentally
   * different from variant-based adapters — this adapter will match
   * supplement names rather than rsIDs. The enrichment engine should
   * call this adapter with supplement names (e.g., "Vitamin D",
   * "Folate") rather than rsID strings. This adapter will provide
   * dosage ranges (RDA, UL) and safety data rather than variant-level
   * findings. For now, returns empty results until the query interface
   * is extended to support nutritional lookups.
   */
  async query(): Promise<NormalizedFinding[]> {
    // Nutritional adapters do not match on rsIDs — they provide
    // supplement reference data keyed by supplement name. Return
    // empty until the enrichment pipeline supports nutritional queries.
    return [];
  }

  getVersion(): string {
    return this.config.version;
  }

  isAvailable(): boolean {
    return this.loaded;
  }
}
