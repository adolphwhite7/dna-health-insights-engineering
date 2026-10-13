/**
 * Data Source Abstraction Layer
 *
 * Re-exports all types and the source registry for convenient imports:
 *   import { sourceRegistry, NormalizedFinding, DataSourceAdapter } from '@/lib/data-sources';
 */

export type {
  NormalizedFinding,
  SourceConfig,
  DataSourceAdapter,
  FindingCategory,
  EvidenceLevel,
  DataSourceId,
  LicenseId,
} from "./types";

export { SourceRegistry, sourceRegistry } from "./registry";
export type { RegistryConfig, QueryAllResult } from "./registry";

export { ClinVarAdapter } from "./clinvar-adapter";
export { CpicAdapter } from "./cpic-adapter";
export { NihOdsAdapter } from "./nih-ods-adapter";
