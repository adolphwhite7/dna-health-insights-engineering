const DNA_RESULTS_KEY = "dna-results";
const DNA_RESULTS_LATEST_KEY = "dna-results:latest";
const LATEST_REPORT_TTL_MS = 12 * 60 * 60 * 1000;

type StoredReportEnvelope = {
  version: 1;
  payload: string;
  ownerUserId: string | null;
  createdAt: string;
  expiresAt: string;
};

type ReadOptions = {
  expectedOwnerUserId?: string | null;
};

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function writeStoredDnaResults(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const now = Date.now();
  const parsed = parsePayload(serialized);
  const envelope: StoredReportEnvelope = {
    version: 1,
    payload: serialized,
    ownerUserId: getPayloadOwnerUserId(parsed),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LATEST_REPORT_TTL_MS).toISOString(),
  };
  const session = getSessionStorage();
  const local = getLocalStorage();
  const previousSession = session?.getItem(DNA_RESULTS_KEY) ?? null;
  const previousLocal = local?.getItem(DNA_RESULTS_LATEST_KEY) ?? null;

  try {
    local?.setItem(DNA_RESULTS_LATEST_KEY, JSON.stringify(envelope));
    session?.setItem(DNA_RESULTS_KEY, serialized);
  } catch (error) {
    restoreStorageValue(session, DNA_RESULTS_KEY, previousSession);
    restoreStorageValue(local, DNA_RESULTS_LATEST_KEY, previousLocal);
    throw error;
  }
}

export function readStoredDnaResults(options: ReadOptions = {}): string | null {
  const session = getSessionStorage();
  const sessionValue = session?.getItem(DNA_RESULTS_KEY);
  if (sessionValue && isOwnerAllowed(sessionValue, options)) return sessionValue;
  if (sessionValue) session?.removeItem(DNA_RESULTS_KEY);

  const local = getLocalStorage();
  const latestValue = local?.getItem(DNA_RESULTS_LATEST_KEY) ?? null;
  if (!latestValue) return null;

  const envelope = parseEnvelope(latestValue);
  if (!envelope || !isEnvelopeFresh(envelope) || !isOwnerAllowed(envelope.payload, options)) {
    local?.removeItem(DNA_RESULTS_LATEST_KEY);
    return null;
  }

  session?.setItem(DNA_RESULTS_KEY, envelope.payload);
  return envelope.payload;
}

export function clearStoredDnaResults(): void {
  getSessionStorage()?.removeItem(DNA_RESULTS_KEY);
  getLocalStorage()?.removeItem(DNA_RESULTS_LATEST_KEY);
}

export const reportStorageKeys = {
  session: DNA_RESULTS_KEY,
  latest: DNA_RESULTS_LATEST_KEY,
} as const;

function parsePayload(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function restoreStorageValue(storage: Storage | null, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Best-effort rollback when the storage backend itself is unavailable.
  }
}

function parseEnvelope(serialized: string): StoredReportEnvelope | null {
  const parsed = parsePayload(serialized);
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as StoredReportEnvelope).version === 1 &&
    typeof (parsed as StoredReportEnvelope).payload === "string" &&
    typeof (parsed as StoredReportEnvelope).expiresAt === "string"
  ) {
    return parsed as StoredReportEnvelope;
  }
  return null;
}

function getPayloadOwnerUserId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const owner = (value as { ownerUserId?: unknown }).ownerUserId;
  return typeof owner === "string" && owner.length > 0 ? owner : null;
}

function isEnvelopeFresh(envelope: StoredReportEnvelope): boolean {
  const expiresAt = Date.parse(envelope.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function isOwnerAllowed(serializedPayload: string, options: ReadOptions): boolean {
  const ownerUserId = getPayloadOwnerUserId(parsePayload(serializedPayload));
  if (!ownerUserId) return true;
  if (!Object.prototype.hasOwnProperty.call(options, "expectedOwnerUserId")) return false;
  return options.expectedOwnerUserId === ownerUserId;
}
