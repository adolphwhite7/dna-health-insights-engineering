/**
 * Evidence-provenance derivation for PerformanceSuite findings.
 *
 * Derives a structured evidence-provenance object from the real fields
 * present on each finding record. Returns `null` when the record carries
 * no usable evidence signal whatsoever (no significance, no level,
 * no source).
 *
 * Tier-1: no raw rsID/allele/genotype in any fixture — synthetic
 * significance/level strings only.
 */

export type EvidenceProvenance = {
  sourceClass: "curated" | "clinvar" | "pharmgkb";
  evidenceHeld: string;
  settledLevel: "well-established" | "emerging" | "preliminary";
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function detectSourceClass(input: Record<string, unknown>): "curated" | "clinvar" | "pharmgkb" {
  const source = firstString(input.source, input.evidence_source, input.evidenceSource)?.toLowerCase() ?? "";

  if (source === "clinvar" || source === "clinvar_curated") return "clinvar";
  if (source === "pharmgkb" || source === "pharmacogenomic_annotations") return "pharmgkb";
  if (source === "snp_database" || source === "curated") return "curated";

  const level = firstString(input.level, input.evidence_level, input.evidenceLevel);
  if (level && /^[12][AB]$|^3$|^4$/.test(level)) return "pharmgkb";

  const sig = firstString(input.clinical_significance, input.significance)?.toLowerCase() ?? "";
  if (
    sig.includes("pathogenic") ||
    sig.includes("benign") ||
    sig.includes("uncertain") ||
    sig.includes("drug response") ||
    sig.includes("risk factor") ||
    sig.includes("protective") ||
    sig.includes("carrier")
  ) {
    return "clinvar";
  }

  return "curated";
}

function hasUsableEvidenceSignal(input: Record<string, unknown>): boolean {
  const level = firstString(input.level, input.evidence_level, input.evidenceLevel);
  const significance = firstString(
    input.clinical_significance,
    input.significance,
    input.status,
    input.classification,
  );
  const source = firstString(input.source, input.evidence_source, input.evidenceSource);
  return !!(level || significance || source);
}

function deriveSettledLevel(
  sourceClass: "curated" | "clinvar" | "pharmgkb",
  input: Record<string, unknown>,
): EvidenceProvenance["settledLevel"] {
  if (sourceClass === "clinvar") {
    const sig = firstString(input.clinical_significance, input.significance)?.toLowerCase() ?? "";
    if (sig.includes("pathogenic") && !sig.includes("likely")) return "well-established";
    if (sig.includes("likely") && sig.includes("pathogenic")) return "well-established";
    if (sig.includes("protective")) return "well-established";
    if (sig.includes("drug response")) return "well-established";
    if (sig.includes("uncertain")) return "emerging";
    if (sig.includes("risk factor")) return "emerging";
    if (sig.includes("likely") && sig.includes("benign")) return "emerging";
    if (sig.includes("benign")) return "preliminary";
    return "preliminary";
  }

  if (sourceClass === "pharmgkb") {
    const level = firstString(input.level, input.evidence_level, input.evidenceLevel)?.toUpperCase() ?? "";
    if (level === "1A" || level === "1B") return "well-established";
    if (level === "2A" || level === "2B") return "emerging";
    return "preliminary";
  }

  // curated
  const status = firstString(
    input.status,
    input.classification,
    input.clinical_significance,
    input.significance,
  )?.toLowerCase() ?? "";

  if (status.includes("pathogenic")) return "well-established";
  if (status.includes("protective")) return "well-established";
  if (status.includes("well-established")) return "well-established";

  if (status.includes("risk")) return "emerging";
  if (status.includes("uncertain")) return "emerging";
  if (status.includes("emerging")) return "emerging";
  if (status.includes("moderate")) return "emerging";

  if (status.includes("preliminary")) return "preliminary";
  if (status.includes("weak")) return "preliminary";
  if (status.includes("benign")) return "preliminary";
  if (status.includes("normal")) return "preliminary";
  if (status.includes("wellness")) return "preliminary";

  return "preliminary";
}

function buildEvidenceHeld(
  sourceClass: "curated" | "clinvar" | "pharmgkb",
  input: Record<string, unknown>,
): string {
  const level = firstString(input.level, input.evidence_level, input.evidenceLevel);
  const significance = firstString(
    input.clinical_significance,
    input.significance,
    input.status,
    input.classification,
  );
  const source = firstString(input.source, input.evidence_source, input.evidenceSource);

  if (sourceClass === "pharmgkb" && level) return `PharmGKB level ${level.toUpperCase()}`;
  if (sourceClass === "clinvar" && significance) return `ClinVar: ${significance}`;
  if (significance) return `curated significance: ${significance}`;
  if (level) return `evidence level ${level}`;
  return `source-declared: ${source ?? "unspecified"}`;
}

/**
 * Derive a real, field-sourced evidence-provenance object for a finding.
 *
 * @param input - A finding record (RichFindingRecord-compatible).
 * @returns EvidenceProvenance when usable evidence fields are present;
 *          `null` when the record is genuinely unsourceable.
 */
export function deriveEvidenceProvenance(input: Record<string, unknown>): EvidenceProvenance | null {
  if (!hasUsableEvidenceSignal(input)) {
    return null;
  }

  const sourceClass = detectSourceClass(input);
  const settledLevel = deriveSettledLevel(sourceClass, input);
  const evidenceHeld = buildEvidenceHeld(sourceClass, input);

  return { sourceClass, evidenceHeld, settledLevel };
}
