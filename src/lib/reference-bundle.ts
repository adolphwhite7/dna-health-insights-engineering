import { base64url, flattenedVerify, type FlattenedJWSInput, type JWK } from "jose";
import pinnedReferenceBundlePublicKey from "./reference-bundle-public-key.json";

export const REFERENCE_BUNDLE_ARTIFACT_KEYS = [
  "clinvar_curated",
  "pharmgkb_curated",
  "snp_database",
] as const;

export type ReferenceBundleArtifactKey = (typeof REFERENCE_BUNDLE_ARTIFACT_KEYS)[number];

export interface ReferenceBundleArtifact {
  file: string;
  version: string;
  sha256: string;
  size: number;
  records: number;
  schema_sha256: string;
  source_id: string;
  source_release_id: string;
  source_release_status: "verified_upstream" | "imported_baseline_unverified_upstream_date";
}

export interface ReferenceBundle {
  schema: "reference-bundle/v1";
  bundle_id: string;
  sequence: number;
  issued_at: string;
  predecessor_bundle_id: string | null;
  rollback_of_bundle_id?: string;
  revoked_bundle_ids?: string[];
  signing_key_id: string;
  artifacts: Record<ReferenceBundleArtifactKey, ReferenceBundleArtifact>;
}

interface DetachedBundleSignature {
  protected: string;
  signature: string;
}

const BUNDLE_URL = "/databases/reference-bundle.json";
const SIGNATURE_URL = "/databases/reference-bundle.jws.json";
const SHA256_RE = /^[a-f0-9]{64}$/;
const REFERENCE_REQUEST_TIMEOUT_MS = 30_000;

export async function fetchReferenceResource<T>(
  url: string,
  consume: (response: Response) => Promise<T>,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  let response: Response | null = null;
  let rejectDeadline!: (error: DOMException) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timeout = setTimeout(() => {
    const error = new DOMException("Reference request timed out.", "TimeoutError");
    controller.abort(error);
    const cancellation = response?.body?.cancel(error);
    if (cancellation) void cancellation.catch(() => undefined);
    rejectDeadline(error);
  }, REFERENCE_REQUEST_TIMEOUT_MS);
  try {
    const operation = (async () => {
      response = await fetch(url, { ...init, signal: controller.signal });
      return consume(response);
    })();
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function bundleIdFor(bundle: Omit<ReferenceBundle, "bundle_id">): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(bundle));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function publicKey(): JWK {
  try {
    const testOverride = process.env.NODE_ENV === "test"
      ? process.env.NEXT_PUBLIC_REFERENCE_BUNDLE_PUBLIC_JWK
      : undefined;
    const key = testOverride
      ? JSON.parse(testOverride) as JWK
      : pinnedReferenceBundlePublicKey as JWK;
    if (key.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string" || typeof key.kid !== "string") {
      throw new Error("invalid Ed25519 JWK");
    }
    return key;
  } catch (error) {
    throw new Error(`Pinned reference bundle public key is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function assertBundle(value: unknown): asserts value is ReferenceBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reference bundle must be an object.");
  }
  const bundle = value as Partial<ReferenceBundle>;
  if (
    bundle.schema !== "reference-bundle/v1" ||
    typeof bundle.bundle_id !== "string" ||
    !SHA256_RE.test(bundle.bundle_id) ||
    !Number.isSafeInteger(bundle.sequence) ||
    (bundle.sequence ?? 0) < 1 ||
    typeof bundle.issued_at !== "string" ||
    Number.isNaN(Date.parse(bundle.issued_at)) ||
    (bundle.predecessor_bundle_id !== null &&
      (typeof bundle.predecessor_bundle_id !== "string" || !SHA256_RE.test(bundle.predecessor_bundle_id))) ||
    (bundle.rollback_of_bundle_id !== undefined &&
      (typeof bundle.rollback_of_bundle_id !== "string" || !SHA256_RE.test(bundle.rollback_of_bundle_id))) ||
    (bundle.revoked_bundle_ids !== undefined &&
      (!Array.isArray(bundle.revoked_bundle_ids) ||
        bundle.revoked_bundle_ids.some((id) => typeof id !== "string" || !SHA256_RE.test(id)) ||
        new Set(bundle.revoked_bundle_ids).size !== bundle.revoked_bundle_ids.length)) ||
    typeof bundle.signing_key_id !== "string" ||
    !bundle.artifacts ||
    typeof bundle.artifacts !== "object"
  ) {
    throw new Error("Reference bundle has an invalid envelope.");
  }

  const keys = Object.keys(bundle.artifacts).sort();
  if (
    keys.length !== REFERENCE_BUNDLE_ARTIFACT_KEYS.length ||
    !REFERENCE_BUNDLE_ARTIFACT_KEYS.every((key) => keys.includes(key))
  ) {
    throw new Error("Reference bundle must declare the complete artifact set.");
  }

  for (const key of REFERENCE_BUNDLE_ARTIFACT_KEYS) {
    const artifact = bundle.artifacts[key];
    if (
      !artifact ||
      typeof artifact.file !== "string" ||
      typeof artifact.version !== "string" ||
      !SHA256_RE.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 1 ||
      !Number.isSafeInteger(artifact.records) ||
      artifact.records < 0 ||
      !SHA256_RE.test(artifact.schema_sha256) ||
      typeof artifact.source_id !== "string" ||
      typeof artifact.source_release_id !== "string" ||
      !["verified_upstream", "imported_baseline_unverified_upstream_date"].includes(
        artifact.source_release_status,
      )
    ) {
      throw new Error(`Reference bundle artifact ${key} is invalid.`);
    }
  }
}

function assertDetachedSignature(value: unknown): asserts value is DetachedBundleSignature {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as DetachedBundleSignature).protected !== "string" ||
    typeof (value as DetachedBundleSignature).signature !== "string"
  ) {
    throw new Error("Reference bundle signature is invalid.");
  }
}

/** Fetches and verifies the exact signed artifact bundle before any download begins. */
export async function fetchVerifiedReferenceBundle(): Promise<ReferenceBundle> {
  const [bundleText, signatureValue] = await Promise.all([
    fetchReferenceResource(BUNDLE_URL, async (response) => {
      if (!response.ok) {
        throw new Error(`Reference bundle is unavailable (HTTP ${response.status}).`);
      }
      return (await response.text()).trim();
    }, { cache: "no-store" }),
    fetchReferenceResource(SIGNATURE_URL, async (response) => {
      if (!response.ok) {
        throw new Error(`Reference bundle signature is unavailable (HTTP ${response.status}).`);
      }
      return response.json();
    }, { cache: "no-store" }),
  ]);
  let bundleValue: unknown;
  try {
    bundleValue = JSON.parse(bundleText);
  } catch {
    throw new Error("Reference bundle JSON is invalid.");
  }
  assertBundle(bundleValue);
  const { bundle_id: declaredBundleId, ...bundleWithoutId } = bundleValue;
  if (declaredBundleId !== await bundleIdFor(bundleWithoutId)) {
    throw new Error("Reference bundle id does not match its canonical content.");
  }
  assertDetachedSignature(signatureValue);

  const key = publicKey();
  const jws: FlattenedJWSInput = {
    protected: signatureValue.protected,
    signature: signatureValue.signature,
    payload: base64url.encode(new TextEncoder().encode(bundleText)),
  };
  const verified = await flattenedVerify(jws, key, { algorithms: ["EdDSA"] });
  const keyId = key.kid;
  if (!keyId || verified.protectedHeader?.kid !== keyId || bundleValue.signing_key_id !== keyId) {
    throw new Error("Reference bundle signing key does not match the pinned key.");
  }

  return bundleValue;
}
