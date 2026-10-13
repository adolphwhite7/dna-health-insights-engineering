/**
 * Data Source Registry — Central coordinator for all data source adapters.
 *
 * Maintains a registry of DataSourceAdapters, manages feature flags,
 * and provides unified query across all enabled sources.
 *
 * JIRA: DNA-829
 */

import type {
  DataSourceAdapter,
  NormalizedFinding,
  SourceConfig,
} from "./types";

import { ClinVarAdapter } from "./clinvar-adapter";
import { CpicAdapter } from "./cpic-adapter";
import { NihOdsAdapter } from "./nih-ods-adapter";

// ─── Input Validation ───

/** Maximum number of rsIDs/gene keys per query to prevent resource exhaustion */
const MAX_RSID_BATCH = 100_000;
/** Maximum length for a single rsID or gene key */
const MAX_KEY_LENGTH = 64;
/** Valid rsID pattern: rs followed by digits, or chrom:pos:ref:alt format, or gene symbol */
const VALID_KEY_PATTERN = /^(rs\d+|[0-9XYM]{1,2}:\d+:[ACGT]+:[ACGT]+|[A-Za-z0-9_-]+)$/;

/**
 * Sanitize, deduplicate, and cap an rsID/gene-key list.
 * Rejects malformed inputs before they reach any adapter.
 */
function normalizeRsidList(rsids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rsids) {
    if (result.length >= MAX_RSID_BATCH) break;

    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_KEY_LENGTH) continue;
    if (!VALID_KEY_PATTERN.test(trimmed)) continue;

    const normalized = trimmed.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed); // preserve original case for gene keys
    }
  }

  return result;
}

// ─── Query Result ───

export interface QueryAllResult {
  findings: NormalizedFinding[];
  sourceStatus: Record<string, "ok" | "failed" | "disabled">;
}

// ─── Default Source Configurations ───

/**
 * Default source configs define which sources exist and their initial
 * enabled/disabled state. Adapters register against these IDs.
 */
const DEFAULT_SOURCE_CONFIGS: Record<string, Pick<SourceConfig, "id" | "name" | "enabled" | "category" | "license" | "attribution">> = {
  clinvar: {
    id: "clinvar",
    name: "Clinical Variant Database",
    enabled: true,
    category: "clinical",
    license: "public_domain",
    attribution: "ClinVar is a public archive of reports of the relationships among human variations and phenotypes, hosted by NCBI.",
  },
  pharmgkb: {
    id: "pharmgkb",
    name: "Pharmacogenomics Knowledge Base",
    enabled: false,
    category: "pharmacogenomics",
    license: "commercial_agreement_required",
    attribution: "PharmGKB is a curated pharmacogenomics resource that helps explain what published evidence says about how genetic variation may influence medication response. We use this evidence as educational context for conversations with a clinician or pharmacist, not to diagnose, prescribe, or recommend individualized treatment.",
  },
  cpic: {
    id: "cpic",
    name: "Clinical Pharmacogenetics Consortium",
    enabled: false,
    category: "pharmacogenomics",
    license: "cc0",
    attribution: "CPIC provides peer-reviewed, updated, evidence-based, freely accessible gene/drug clinical practice guidelines.",
  },
  nih_ods: {
    id: "nih_ods",
    name: "NIH Office of Dietary Supplements",
    enabled: false,
    category: "nutritional",
    license: "public_domain",
    attribution: "NIH Office of Dietary Supplements provides evidence-based information on dietary supplements.",
  },
};

// ─── Feature Flag Resolution ───

/**
 * Resolves whether a source should be enabled by checking (in order):
 * 1. Runtime override map (if provided)
 * 2. Environment variable: DATA_SOURCE_{ID}_ENABLED (e.g., DATA_SOURCE_CPIC_ENABLED=true)
 * 3. Default config value
 */
function resolveEnabled(
  sourceId: string,
  defaultEnabled: boolean,
  overrides?: Record<string, boolean>
): boolean {
  // Check runtime override first
  if (overrides && sourceId in overrides) {
    return overrides[sourceId];
  }

  // Check environment variable (server-side only)
  if (typeof process !== "undefined" && process.env) {
    const envKey = `DATA_SOURCE_${sourceId.toUpperCase()}_ENABLED`;
    const envVal = process.env[envKey];
    if (envVal === "true") return true;
    if (envVal === "false") return false;
  }

  return defaultEnabled;
}

// ─── Registry Configuration ───

export interface RegistryConfig {
  /** Override enabled/disabled per source ID */
  featureFlags?: Record<string, boolean>;
}

// ─── Source Registry ───

export class SourceRegistry {
  private adapters: Map<string, DataSourceAdapter> = new Map();
  private enabledOverrides: Map<string, boolean> = new Map();

  constructor(config?: RegistryConfig) {
    if (config?.featureFlags) {
      for (const [id, enabled] of Object.entries(config.featureFlags)) {
        this.enabledOverrides.set(id, enabled);
      }
    }
  }

  /**
   * Register a data source adapter. The adapter's config.id must be unique.
   * If the source ID has a feature flag override, it is applied to the adapter's config.
   */
  registerSource(adapter: DataSourceAdapter): void {
    const id = adapter.config.id;

    if (this.adapters.has(id)) {
      console.warn(
        `[SourceRegistry] Replacing existing adapter for source "${id}"`
      );
    }

    // Apply feature flag overrides
    const overrides = Object.fromEntries(this.enabledOverrides);
    const defaultConfig = DEFAULT_SOURCE_CONFIGS[id];
    const defaultEnabled = defaultConfig?.enabled ?? adapter.config.enabled;

    adapter.config.enabled = resolveEnabled(id, defaultEnabled, overrides);

    this.adapters.set(id, adapter);
  }

  /**
   * Get a registered adapter by source ID.
   * Returns undefined if the source is not registered OR is disabled.
   * Use getSourceUnsafe() only for administrative/diagnostic access.
   */
  getSource(id: string): DataSourceAdapter | undefined {
    const adapter = this.adapters.get(id);
    if (!adapter || !adapter.config.enabled) return undefined;
    return adapter;
  }

  /**
   * Get a registered adapter regardless of enabled state.
   * For administrative/diagnostic use only — never for query paths.
   */
  getSourceUnsafe(id: string): DataSourceAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get all registered adapters that are currently enabled.
   */
  getEnabledSources(): DataSourceAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (adapter) => adapter.config.enabled && adapter.isAvailable()
    );
  }

  /**
   * Get all enabled adapters matching a specific category.
   */
  getEnabledSourcesByCategory(category: string): DataSourceAdapter[] {
    return this.getEnabledSources().filter(
      (adapter) => adapter.config.category === category
    );
  }

  /**
   * Check if a source is registered, enabled, and available.
   */
  isSourceEnabled(id: string): boolean {
    const adapter = this.adapters.get(id);
    return adapter !== undefined && adapter.config.enabled && adapter.isAvailable();
  }

  /**
   * Disable a source at runtime (does not unregister it).
   */
  disableSource(id: string): void {
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.config.enabled = false;
      this.enabledOverrides.set(id, false);
    }
  }

  /**
   * Enable a source at runtime.
   * Sources with commercial_agreement_required license cannot be enabled
   * without an explicit legal override.
   */
  enableSource(id: string, legalOverride = false): void {
    const adapter = this.adapters.get(id);
    if (!adapter) return;

    // Prevent enabling commercially restricted sources without explicit legal gate
    const defaultConfig = DEFAULT_SOURCE_CONFIGS[id];
    if (defaultConfig?.license === "commercial_agreement_required" && !legalOverride) {
      console.warn(
        `[SourceRegistry] Cannot enable "${id}" — commercial agreement required. ` +
        `Pass legalOverride=true if a commercial license is in place.`
      );
      return;
    }

    adapter.config.enabled = true;
    this.enabledOverrides.set(id, true);
  }

  /**
   * Initialize all registered adapters that are enabled.
   * Call once before querying to ensure adapters have loaded their data.
   */
  async initializeAll(): Promise<void> {
    const enabled = this.getEnabledSources();
    const results = await Promise.allSettled(
      enabled.map((adapter) => adapter.initialize())
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const sourceId = enabled[index].config.id;
        console.error(
          `[SourceRegistry] Initialization failed for "${sourceId}":`,
          result.reason
        );
      }
    });
  }

  /**
   * Query ALL enabled sources in parallel and merge results.
   * Sources that fail are logged and skipped — partial results are
   * returned rather than failing the entire query.
   *
   * Returns both findings and per-source status for failure tracking.
   */
  async queryAll(rsids: string[]): Promise<QueryAllResult> {
    const sanitized = normalizeRsidList(rsids);
    const enabledSources = this.getEnabledSources();
    const sourceStatus: Record<string, "ok" | "failed" | "disabled"> = {};

    // Mark disabled sources
    for (const id of this.getRegisteredSourceIds()) {
      if (!this.isSourceEnabled(id)) {
        sourceStatus[id] = "disabled";
      }
    }

    if (enabledSources.length === 0) {
      return { findings: [], sourceStatus };
    }

    const results = await Promise.allSettled(
      enabledSources.map((adapter) => adapter.query(sanitized))
    );

    const findings: NormalizedFinding[] = [];

    results.forEach((result, index) => {
      const sourceId = enabledSources[index].config.id;
      if (result.status === "fulfilled") {
        findings.push(...result.value);
        sourceStatus[sourceId] = "ok";
      } else {
        sourceStatus[sourceId] = "failed";
        console.error(
          `[SourceRegistry] Query failed for source "${sourceId}":`,
          result.reason
        );
      }
    });

    return { findings, sourceStatus };
  }

  /**
   * Get all registered source IDs (enabled and disabled).
   */
  getRegisteredSourceIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get the default source configurations (for reference/tooling).
   */
  static getDefaultConfigs(): Record<string, Pick<SourceConfig, "id" | "name" | "enabled" | "category" | "license" | "attribution">> {
    return { ...DEFAULT_SOURCE_CONFIGS };
  }
}

// ─── Singleton Export ───

export const sourceRegistry = new SourceRegistry();

// ─── Auto-register built-in adapters ───
sourceRegistry.registerSource(new ClinVarAdapter());
sourceRegistry.registerSource(new CpicAdapter());
sourceRegistry.registerSource(new NihOdsAdapter());
