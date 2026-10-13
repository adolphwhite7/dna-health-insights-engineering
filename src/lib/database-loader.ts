/**
 * Database Loader — fetches curated database subsets from /databases/,
 * decompresses gzipped files, and stores them in IndexedDB via indexed-db.ts.
 *
 * Supports:
 *   - clinvar_curated.json.gz   (~0.7 MB gzipped, ~7 MB uncompressed)
 *   - pharmacogenomic_curated.json.gz  (~0.4 MB gzipped, ~4 MB uncompressed)
 *   - snp_database.json         (~39 KB, not compressed)
 *
 * Each database file includes a `version` field. The loader checks IndexedDB
 * metadata to skip re-downloading if the cached version matches.
 *
 * Integrity: On first load, manifest.json is fetched to obtain SHA-256
 * hashes. Every downloaded file is verified against its manifest hash
 * before being stored. The hash is also persisted in IndexedDB so
 * subsequent loads can detect corruption without re-downloading.
 */

import {
  type ReferenceDatabaseName,
  type VariantAnnotation,
  hasActiveReferenceBundle,
  getActiveReferenceBundle,
  isDatabaseLoaded,
  isReferenceBundleActive,
  loadDatabase,
  loadReferenceBundle,
  areAllDatabasesLoaded,
} from "./indexed-db";
import {
  fetchVerifiedReferenceBundle,
  fetchReferenceResource,
  type ReferenceBundle,
  type ReferenceBundleArtifact,
  type ReferenceBundleArtifactKey,
} from "./reference-bundle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatabaseLoadProgress {
  database: string;
  phase: "checking" | "downloading" | "decompressing" | "verifying" | "storing" | "done" | "cached";
  bytesLoaded?: number;
  bytesTotal?: number;
  percent?: number;
}

export type ProgressCallback = (progress: DatabaseLoadProgress) => void;

export interface LoadAllResult {
  allLoaded: boolean;
  failed: string[];
  usingLastKnownGood?: boolean;
  referenceBundle?: {
    bundleId: string;
    sequence: number;
  };
  failure?: ReferenceLoadFailure;
}

export interface ReferenceLoadFailure {
  kind: "network" | "integrity" | "storage" | "release" | "unsupported" | "unknown";
  code:
    | "REFERENCE_NETWORK"
    | "REFERENCE_TIMEOUT"
    | "REFERENCE_INTEGRITY"
    | "REFERENCE_STORAGE"
    | "REFERENCE_STORAGE_BUSY"
    | "REFERENCE_RELEASE_CHANGED"
    | "REFERENCE_RELEASE_CHAIN"
    | "REFERENCE_UNSUPPORTED"
    | "REFERENCE_UNKNOWN";
  retryable: boolean;
}

interface DatabaseManifestEntry {
  name: ReferenceDatabaseName;
  url: string;
  gzipped: boolean;
}

/** Shape of each entry in manifest.json */
interface ManifestRecord {
  file: string;
  version: string;
  sha256: string;
  records: number;
  size: number;
}

type Manifest = Record<string, ManifestRecord>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum size (bytes) for any single downloaded database file (50 MB). */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Manifest — maps database names to their fetch URLs
// ---------------------------------------------------------------------------

const DATABASE_MANIFEST: DatabaseManifestEntry[] = [
  { name: "clinvar_curated", url: "/databases/clinvar_curated.json.gz", gzipped: true },
  { name: "pharmacogenomic_annotations", url: "/databases/pharmgkb_curated.json.gz", gzipped: true },
  { name: "snp_database", url: "/databases/snp_database.json", gzipped: false },
];

// Cached integrity manifest (fetched once per page load)
let _manifestCache: Manifest | null = null;
let _loadAllDatabasesPromise: Promise<LoadAllResult> | null = null;
const _loadAllProgressListeners = new Set<ProgressCallback>();

const BUNDLE_KEY_BY_DATABASE: Record<ReferenceDatabaseName, ReferenceBundleArtifactKey> = {
  clinvar_curated: "clinvar_curated",
  pharmacogenomic_annotations: "pharmgkb_curated",
  snp_database: "snp_database",
};

const SCHEMA_DESCRIPTOR_BY_DATABASE: Record<ReferenceDatabaseName, string> = {
  clinvar_curated: "clinvar-curated/v1",
  pharmacogenomic_annotations: "pharmacogenomic-curated/v1",
  snp_database: "snp-database/v1",
};

function isSignedBundleEnforced(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_REFERENCE_BUNDLE_ENFORCEMENT === "true"
  );
}

function emitLoadAllProgress(progress: DatabaseLoadProgress): void {
  for (const listener of _loadAllProgressListeners) {
    try {
      listener(progress);
    } catch (err) {
      console.warn("Database load progress listener failed:", err);
    }
  }
}

function classifyReferenceFailure(error: unknown): ReferenceLoadFailure {
  const errorLike =
    error && typeof error === "object"
      ? (error as { name?: unknown; message?: unknown })
      : null;
  const name = typeof errorLike?.name === "string" ? errorLike.name : "";
  const message =
    typeof errorLike?.message === "string"
      ? errorLike.message.toLowerCase()
      : String(error).toLowerCase();

  if (name === "QuotaExceededError") {
    return { kind: "storage", code: "REFERENCE_STORAGE", retryable: false };
  }
  if (name === "NotSupportedError" || name === "InvalidStateError") {
    return { kind: "unsupported", code: "REFERENCE_UNSUPPORTED", retryable: false };
  }
  if (message.includes("activation aborted") || message.includes("upgrade blocked")) {
    return { kind: "storage", code: "REFERENCE_STORAGE_BUSY", retryable: true };
  }
  if (message.includes("refresh lock timed out")) {
    return { kind: "storage", code: "REFERENCE_STORAGE_BUSY", retryable: true };
  }
  if (name === "TimeoutError" || message.includes("timed out")) {
    return { kind: "network", code: "REFERENCE_TIMEOUT", retryable: true };
  }
  if (
    name === "AbortError" ||
    name === "NetworkError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("http 429") ||
    /http [^)]*5\d\d/.test(message)
  ) {
    return { kind: "network", code: "REFERENCE_NETWORK", retryable: true };
  }
  if (message.includes("changed during refresh")) {
    return { kind: "release", code: "REFERENCE_RELEASE_CHANGED", retryable: true };
  }
  if (
    message.includes("signature") ||
    message.includes("integrity") ||
    message.includes("canonical content") ||
    message.includes("schema mismatch") ||
    message.includes("metadata mismatch") ||
    message.includes("invalid")
  ) {
    return { kind: "integrity", code: "REFERENCE_INTEGRITY", retryable: false };
  }
  if (message.includes("release chain") || message.includes("revoke")) {
    return { kind: "release", code: "REFERENCE_RELEASE_CHAIN", retryable: false };
  }
  return { kind: "unknown", code: "REFERENCE_UNKNOWN", retryable: false };
}

async function withReferenceRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException("Reference refresh lock timed out.", "TimeoutError"),
      );
    }, 30_000);
    try {
      return await navigator.locks.request(
        "dna-reference-bundle-refresh",
        { signal: controller.signal },
        async () => {
          clearTimeout(timeout);
          return operation();
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return operation();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the integrity manifest from /databases/manifest.json.
 * Cached after the first successful fetch.
 */
async function fetchManifest(): Promise<Manifest> {
  if (_manifestCache) return _manifestCache;
  const response = await fetch("/databases/manifest.json");
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
  }
  _manifestCache = (await response.json()) as Manifest;
  return _manifestCache;
}

/**
 * Compute SHA-256 hex digest of an ArrayBuffer using the Web Crypto API.
 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function schemaHash(dbName: ReferenceDatabaseName): Promise<string> {
  const bytes = new TextEncoder().encode(SCHEMA_DESCRIPTOR_BY_DATABASE[dbName]);
  return sha256Hex(bytes.buffer as ArrayBuffer);
}

/**
 * Fetch a URL with progress reporting.  Returns the raw ArrayBuffer.
 * Enforces a size cap to prevent gzip-bomb DoS.
 */
async function fetchWithProgress(
  url: string,
  dbName: string,
  onProgress?: ProgressCallback,
  init?: RequestInit,
): Promise<ArrayBuffer> {
  return fetchReferenceResource(url, async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : undefined;

    // Reject obviously oversized responses before reading body
    if (total !== undefined && total > MAX_FILE_SIZE) {
      throw new Error(
        `Database ${dbName} exceeds size cap: ${total} bytes > ${MAX_FILE_SIZE} bytes`,
      );
    }

    // If no ReadableStream support or no content-length, fall back to simple fetch
    if (!response.body || total === undefined) {
      onProgress?.({ database: dbName, phase: "downloading" });
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(
          `Database ${dbName} exceeds size cap: ${buffer.byteLength} bytes > ${MAX_FILE_SIZE} bytes`,
        );
      }
      onProgress?.({
        database: dbName,
        phase: "downloading",
        bytesLoaded: buffer.byteLength,
        bytesTotal: buffer.byteLength,
        percent: 100,
      });
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (loaded > MAX_FILE_SIZE) {
        void reader.cancel();
        throw new Error(
          `Database ${dbName} exceeds size cap during download: ${loaded} bytes > ${MAX_FILE_SIZE} bytes`,
        );
      }
      onProgress?.({
        database: dbName,
        phase: "downloading",
        bytesLoaded: loaded,
        bytesTotal: total,
        percent: Math.round((loaded / total) * 100),
      });
    }

    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  }, init);
}

/**
 * Decompress a gzipped ArrayBuffer using the browser DecompressionStream API.
 */
async function decompressGzip(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new DOMException(
      "This browser cannot decompress signed reference data.",
      "NotSupportedError",
    );
  }
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(new Uint8Array(buffer));
  writer.close();

  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
}

// ---------------------------------------------------------------------------
// Record Transformers — convert compact JSON to VariantAnnotation[]
// ---------------------------------------------------------------------------

function transformClinvar(
  records: Array<{ k: string; g: string; c: string; t: string }>,
): VariantAnnotation[] {
  return records.map((r) => ({
    rsid: r.k, // chr:pos:ref:alt key
    gene: r.g,
    significance: r.c,
    description: r.t,
    source: "clinvar_curated" as const,
  }));
}

export type PharmgkbAssociationDisposition =
  | "reportable"
  | "conditional_unknown"
  | "unclassified";

export type PharmgkbAssociationOutcome =
  | "increased"
  | "decreased"
  | "unchanged"
  | "mixed"
  | "not_stated";

const NON_REPORTABLE_PHARMGKB_SOURCE_CLAUSES = [
  "have an unknown response",
  "have an unknown likelihood",
] as const;

export function pharmgkbAssociationDisposition(
  annotationText: string,
): PharmgkbAssociationDisposition {
  const normalized = annotationText.trim().toLowerCase();
  if (!normalized) return "unclassified";
  return NON_REPORTABLE_PHARMGKB_SOURCE_CLAUSES.some((clause) =>
    normalized.includes(clause)
  )
    ? "conditional_unknown"
    : "reportable";
}

export function pharmgkbAssociationOutcome(
  annotationText: string,
): PharmgkbAssociationOutcome {
  const normalized = annotationText.trim().toLowerCase();
  if (!normalized) return "not_stated";
  const patientClause = normalized.includes("patients with")
    ? normalized.slice(normalized.indexOf("patients with"))
    : normalized;
  const primaryClause = patientClause
    .split(/\b(?:however|other genetic|other clinical)\b/, 1)[0]
    ?.split(/\b(?:as compared to|compared to|than patients?)\b/, 1)[0]
    ?.trim() ?? "";
  if (
    primaryClause.includes("no significant association") ||
    primaryClause.includes("not have altered") ||
    primaryClause.includes("normal function") ||
    /\bunchanged\b/.test(primaryClause)
  ) {
    return "unchanged";
  }
  const increased = /\b(?:increased|higher|more|rapid|ultrarapid)\b/.test(primaryClause);
  const decreased = /\b(?:decreased|lower|less|slower|reduced|poor)\b/.test(primaryClause);
  if (increased && decreased) return "mixed";
  if (increased) return "increased";
  if (decreased) return "decreased";
  return "not_stated";
}

export function transformPharmaAnnotations(
  records: Record<string, Array<{ g: string; dr: string; p: string; l: string; cat: string; al: Array<{ a: string; d: string }> }>>,
): VariantAnnotation[] {
  // Group all annotations per rsid into a single record with an annotations array.
  // This prevents IndexedDB (keyed by rsid) from overwriting multiple annotations
  // for the same rsid. (Finding 1 fix: compound storage per rsid)
  return Object.entries(records).map(([rsid, anns]) => ({
    rsid,
    source: "pharmacogenomic_annotations" as const,
    annotations: anns.map((a, annotationIndex) => ({
      gene: a.g,
      significance: a.l,
      description: `${a.dr} — ${a.p} (${a.cat})`,
      drugs: a.dr,
      phenotype: a.p,
      category: a.cat,
      alleles: a.al.map((allele) => ({
        ...allele,
        sourceAssociationId: `clinpgx:${rsid}:${annotationIndex}:${allele.a}`,
        associationDisposition: pharmgkbAssociationDisposition(allele.d),
        associationOutcome: pharmgkbAssociationOutcome(allele.d),
      })),
    })),
  }));
}

function transformSnpDatabase(
  records: Record<string, Record<string, unknown>>,
): VariantAnnotation[] {
  return Object.entries(records).map(([rsid, info]) => ({
    rsid,
    source: "snp_database" as const,
    ...info,
  }));
}

function transformDatabase(name: ReferenceDatabaseName, data: { records?: unknown }): VariantAnnotation[] {
  if (name === "clinvar_curated" && Array.isArray(data.records)) {
    return transformClinvar(data.records as Array<{ k: string; g: string; c: string; t: string }>);
  }
  if (name === "pharmacogenomic_annotations" && data.records && typeof data.records === "object") {
    return transformPharmaAnnotations(data.records as Record<string, Array<{ g: string; dr: string; p: string; l: string; cat: string; al: Array<{ a: string; d: string }> }>>);
  }
  if (name === "snp_database" && data.records && typeof data.records === "object") {
    return transformSnpDatabase(data.records as Record<string, Record<string, unknown>>);
  }
  throw new Error(`Database ${name} has an incompatible record schema.`);
}

function recordCount(data: { records?: unknown }): number {
  if (Array.isArray(data.records)) return data.records.length;
  if (data.records && typeof data.records === "object") return Object.keys(data.records).length;
  throw new Error("Database records must be an array or object.");
}

async function stageBundleDatabase(
  entry: DatabaseManifestEntry,
  artifact: ReferenceBundleArtifact,
  onProgress?: ProgressCallback,
): Promise<{ name: ReferenceDatabaseName; records: VariantAnnotation[]; version: string; sha256: string }> {
  if (artifact.file !== entry.url.split("/").pop()) {
    throw new Error(`Reference bundle file mismatch for ${entry.name}.`);
  }
  onProgress?.({ database: entry.name, phase: "downloading" });
  let buffer = await fetchWithProgress(entry.url, entry.name, onProgress, { cache: "no-store" });
  onProgress?.({ database: entry.name, phase: "verifying" });
  let digest = await sha256Hex(buffer);
  if (digest !== artifact.sha256 || buffer.byteLength !== artifact.size) {
    buffer = await fetchWithProgress(entry.url, entry.name, onProgress, { cache: "reload" });
    digest = await sha256Hex(buffer);
    if (digest !== artifact.sha256 || buffer.byteLength !== artifact.size) {
      throw new Error(`Reference bundle integrity check failed for ${entry.name}.`);
    }
  }

  onProgress?.({ database: entry.name, phase: "decompressing" });
  const text = entry.gzipped ? await decompressGzip(buffer) : new TextDecoder().decode(buffer);
  let data: { version?: unknown; records?: unknown };
  try {
    data = JSON.parse(text) as { version?: unknown; records?: unknown };
  } catch {
    throw new Error(`Reference bundle JSON is invalid for ${entry.name}.`);
  }
  if (data.version !== artifact.version || recordCount(data) !== artifact.records) {
    throw new Error(`Reference bundle metadata mismatch for ${entry.name}.`);
  }
  if ((await schemaHash(entry.name)) !== artifact.schema_sha256) {
    throw new Error(`Reference bundle schema mismatch for ${entry.name}.`);
  }

  return {
    name: entry.name,
    records: transformDatabase(entry.name, data),
    version: artifact.version,
    sha256: digest,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a single database: fetch, decompress if needed, verify SHA-256
 * against manifest, parse, and store in IndexedDB.
 * Skips if the database is already cached with the same version AND hash.
 */
export async function loadSingleDatabase(
  entry: DatabaseManifestEntry,
  onProgress?: ProgressCallback,
): Promise<void> {
  const { name, url, gzipped } = entry;

  // Fetch the integrity manifest first
  const manifest = await fetchManifest();
  // Map pharmacogenomic_annotations -> pharmacogenomic_curated for manifest lookup
  const manifestKey = name === "pharmacogenomic_annotations" ? "pharmgkb_curated" : name;
  const manifestEntry = manifest[manifestKey];
  let expectedHash = manifestEntry?.sha256;
  let expectedVersion = manifestEntry?.version;

  if (expectedVersion && await isDatabaseLoaded(name, expectedVersion, expectedHash)) {
    onProgress?.({ database: name, phase: "cached" });
    return;
  }

  onProgress?.({ database: name, phase: "downloading" });
  let buffer = await fetchWithProgress(url, name, onProgress);

  // -- SHA-256 integrity verification --
  onProgress?.({ database: name, phase: "verifying" });
  let downloadHash = await sha256Hex(buffer);
  if (manifestEntry) {
    if (downloadHash !== manifestEntry.sha256) {
      // DNA-4407: retry once with cache-bypass to recover from a stale HTTP cache.
      // Also refresh the manifest in case a same-session DB release shipped a new
      // file AND a new manifest together (otherwise the cached hash stays stale).
      _manifestCache = null;
      const freshManifest = await fetchManifest();
      const freshEntry = freshManifest[manifestKey] ?? manifestEntry;
      onProgress?.({ database: name, phase: "downloading" });
      buffer = await fetchWithProgress(url, name, onProgress, { cache: "reload" });
      downloadHash = await sha256Hex(buffer);
      if (downloadHash !== freshEntry.sha256) {
        throw new Error(
          `Integrity check failed for ${name}: expected SHA-256 ${freshEntry.sha256}, got ${downloadHash}`,
        );
      }
      expectedHash = freshEntry.sha256;
      expectedVersion = freshEntry.version;
    }
  } else {
    // DNA-4407 (Codex F1): fail-closed — never decompress/parse/store unverified bytes.
    throw new Error(
      `No manifest entry for ${name}; refusing to load unverified database.`,
    );
  }

  onProgress?.({ database: name, phase: "decompressing" });
  const jsonString = gzipped ? await decompressGzip(buffer) : new TextDecoder().decode(buffer);

  const data = JSON.parse(jsonString);
  const remoteVersion: string = data.version ?? "unknown";

  // Check if we already have this version AND hash cached
  const alreadyLoaded = await isDatabaseLoaded(name, remoteVersion, expectedHash);
  if (alreadyLoaded) {
    onProgress?.({ database: name, phase: "cached" });
    return;
  }

  onProgress?.({ database: name, phase: "storing" });

  const annotations = transformDatabase(name, data);

  await loadDatabase(name, annotations, remoteVersion, downloadHash);
  onProgress?.({ database: name, phase: "done" });
}

/**
 * Load all curated databases into IndexedDB.
 * Reports progress via callback.  Only downloads databases that are not
 * already cached with the current version.
 *
 * Returns true if all databases are now loaded.
 * Failed database names are returned via the `failed` property so callers
 * can surface degraded (non-blocking) UI state.
 */
export async function loadAllDatabases(
  onProgress?: ProgressCallback,
): Promise<LoadAllResult> {
  if (onProgress) {
    _loadAllProgressListeners.add(onProgress);
  }

  try {
    if (!_loadAllDatabasesPromise) {
      _loadAllDatabasesPromise = withReferenceRefreshLock(async () => {
        if (!isSignedBundleEnforced()) {
          const failed: string[] = [];
          for (const entry of DATABASE_MANIFEST) {
            emitLoadAllProgress({ database: entry.name, phase: "checking" });
            try {
              await loadSingleDatabase(entry, emitLoadAllProgress);
            } catch (error) {
              console.warn(`Failed to load database ${entry.name}:`, error);
              failed.push(entry.name);
            }
          }
          return { allLoaded: await areAllDatabasesLoaded(), failed };
        }

        const hasLastKnownGood = await hasActiveReferenceBundle();
        const activeBundle = hasLastKnownGood
          ? await getActiveReferenceBundle()
          : null;
        let bundle: ReferenceBundle | null = null;
        try {
          bundle = await fetchVerifiedReferenceBundle();
          if (bundle.revoked_bundle_ids?.includes(bundle.bundle_id)) {
            throw new Error("Reference bundle cannot revoke itself.");
          }
          if (
            activeBundle &&
            bundle.bundle_id !== activeBundle.bundleId &&
            (bundle.sequence <= activeBundle.sequence ||
              (bundle.sequence === activeBundle.sequence + 1 &&
                bundle.predecessor_bundle_id !== activeBundle.bundleId) ||
              (bundle.rollback_of_bundle_id !== undefined &&
                bundle.rollback_of_bundle_id !== activeBundle.bundleId))
          ) {
            throw new Error("Reference bundle does not extend the active release chain.");
          }
          if (await isReferenceBundleActive(bundle.bundle_id, bundle.sequence)) {
            const complete = await Promise.all(
              DATABASE_MANIFEST.map((entry) => {
                const artifact = bundle!.artifacts[BUNDLE_KEY_BY_DATABASE[entry.name]];
                return isDatabaseLoaded(
                  entry.name,
                  artifact.version,
                  artifact.sha256,
                  artifact.records,
                );
              }),
            );
            if (complete.every(Boolean)) {
              for (const entry of DATABASE_MANIFEST) {
                emitLoadAllProgress({ database: entry.name, phase: "cached" });
              }
              return {
                allLoaded: true,
                failed: [],
                referenceBundle: {
                  bundleId: bundle.bundle_id,
                  sequence: bundle.sequence,
                },
              };
            }
          }

          const staged = [];
          for (const entry of DATABASE_MANIFEST) {
            emitLoadAllProgress({ database: entry.name, phase: "checking" });
            staged.push(await stageBundleDatabase(
              entry,
              bundle.artifacts[BUNDLE_KEY_BY_DATABASE[entry.name]],
              emitLoadAllProgress,
            ));
          }
          const confirmedBundle = await fetchVerifiedReferenceBundle();
          if (confirmedBundle.bundle_id !== bundle.bundle_id) {
            throw new Error("Reference bundle changed during refresh.");
          }
          await loadReferenceBundle(bundle.bundle_id, bundle.sequence, staged);
          for (const entry of DATABASE_MANIFEST) {
            emitLoadAllProgress({ database: entry.name, phase: "done" });
          }
          return {
            allLoaded: true,
            failed: [],
            referenceBundle: {
              bundleId: bundle.bundle_id,
              sequence: bundle.sequence,
            },
          };
        } catch (error) {
          const failure = classifyReferenceFailure(error);
          if (
            activeBundle &&
            !bundle?.revoked_bundle_ids?.includes(activeBundle.bundleId) &&
            await areAllDatabasesLoaded()
          ) {
            console.warn("Reference bundle rejected; retaining the last known good bundle.", error);
            return {
              allLoaded: true,
              failed: [],
              usingLastKnownGood: true,
              referenceBundle: {
                bundleId: activeBundle.bundleId,
                sequence: activeBundle.sequence,
              },
              failure,
            };
          }
          console.warn("[reference-bundle] activation failed", { code: failure.code });
          return { allLoaded: false, failed: ["reference_bundle"], failure };
        }
      }).catch((error) => {
        const failure = classifyReferenceFailure(error);
        console.warn("[reference-bundle] refresh lock failed", { code: failure.code });
        return { allLoaded: false, failed: ["reference_bundle"], failure };
      }).finally(() => {
        _loadAllDatabasesPromise = null;
      });
    } else {
      onProgress?.({ database: "reference_databases", phase: "checking" });
    }

    return await _loadAllDatabasesPromise;
  } finally {
    if (onProgress) {
      _loadAllProgressListeners.delete(onProgress);
    }
  }
}

/**
 * Get the manifest of databases that will be loaded.
 */
export function getDatabaseManifest(): Array<{ name: string; url: string }> {
  return DATABASE_MANIFEST.map(({ name, url }) => ({ name, url }));
}
