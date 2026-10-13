/**
 * Shared ClinVar Disease Matcher
 *
 * Single source of truth for matching ClinVar clinical variants against a
 * user's genome and producing DiseaseFinding records. Lifted verbatim from the
 * genome-enrichment worker Stage 3 so the production worker
 * (genome-enrichment.worker.ts) and the canonical enrichment engine
 * (enrichment-engine.ts) share ONE matcher — eliminating the silent drift where
 * the engine's copy matched zero ClinVar variants.
 *
 * ClinVar is keyed by "chrom:pos:ref:alt" (NOT by rsid). Matching is by genome
 * POSITION prefix ("chrom:pos") plus an alt-allele-carry requirement: the user
 * must actually carry the alt allele at that position.
 *
 * DNA-4723. Behavior-identical to the prior worker-inline logic.
 */

import type { DiseaseFinding } from "./enrichment-engine";

/** A user's genome variant, indexed by "chrom:pos". */
export interface GenomePositionEntry {
  rsid: string;
  genotype: string;
}

/** Minimal ClinVar annotation fields the matcher consumes. */
export interface ClinVarCandidate {
  gene?: string;
  significance?: string;
  description?: string;
}

/**
 * Map a ClinVar clinical_significance string to a classification bucket.
 * Verbatim from the worker Stage 3 classification chain.
 */
export function classifyClinicalSignificance(significance: string): string {
  const clinSig = (significance || "").toLowerCase();
  if (clinSig.includes("likely") && clinSig.includes("pathogenic")) {
    return "likely_pathogenic";
  } else if (clinSig.includes("pathogenic")) {
    return "pathogenic";
  } else if (clinSig.includes("drug response")) {
    return "drug_response";
  } else if (clinSig.includes("protective")) {
    return "protective";
  } else if (clinSig.includes("risk factor")) {
    return "risk_factor";
  } else {
    return "risk_factor";
  }
}

/**
 * Match position-prefiltered ClinVar candidates against the user's genome and
 * build DiseaseFinding records.
 *
 * @param genomeByPosition  "chrom:pos" -> { rsid, genotype } for the user's genome.
 * @param candidates        Entries of [clinvarKey "chrom:pos:ref:alt", annotation].
 *                          Callers position-prefilter, but this function also
 *                          re-checks the position and enforces alt-allele-carry,
 *                          so it is safe to pass a superset.
 * @returns Flat DiseaseFinding[] (caller buckets into DiseaseFindings).
 */
export function matchClinVarDiseaseFindings(
  genomeByPosition: Map<string, GenomePositionEntry>,
  candidates: Iterable<[string, ClinVarCandidate]>,
): DiseaseFinding[] {
  const findings: DiseaseFinding[] = [];
  const seenKeys = new Set<string>();

  // DNA-4876 item 4: per-record defensive guard. ClinVar curated artifacts are
  // rebuilt on every DB refresh; a single malformed record (non-string key,
  // non-string genotype, null annotation) must drop ONE finding, never throw
  // and collapse the whole clinical-match step. Each iteration is isolated.
  for (const entry of candidates) {
    try {
      // Tolerate a malformed entry tuple itself (not a 2-element [key, ann]).
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const clinvarKey = entry[0];
      const ann = entry[1];

      // Key must be a "chrom:pos:ref:alt" string to be splittable.
      if (typeof clinvarKey !== "string") continue;
      // Annotation must be a usable object; a null/primitive ann is a malformed
      // record — skip it (drop one finding) rather than emit an empty-gene finding.
      if (ann === null || typeof ann !== "object") continue;
      const keyParts = clinvarKey.split(":");
      if (keyParts.length < 4) continue;

      const chrom = keyParts[0];
      const pos = keyParts[1];
      const alt = keyParts[3];

      const posKey = `${chrom}:${pos}`;
      const userData = genomeByPosition.get(posKey);
      if (!userData) continue;

      const userGenotype = userData.genotype;
      // Genotype must be a string before .includes()/concat below.
      if (typeof userGenotype !== "string") continue;
      // Alt-allele-carry: the user must carry the alt allele at this position.
      if (typeof alt !== "string" || !userGenotype.includes(alt)) continue;

      const isHomozygous = userGenotype === alt + alt;
      const zygosity = isHomozygous ? "homozygous" : "heterozygous";

      // ann may be null/undefined or missing fields — read defensively.
      const classification = classifyClinicalSignificance(ann?.significance || "");

      // Dedup by rsid + classification + trait (worker "Finding 3" fix).
      const dedupKey = `${userData.rsid}|${classification}|${ann?.description || ""}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      findings.push({
        rsid: userData.rsid,
        gene: ann?.gene || "",
        genotype: userGenotype,
        clinical_significance: classification,
        traits: ann?.description || "",
        inheritance: "",
        zygosity,
      });
    } catch (recordErr) {
      // Skip the malformed record; never let it abort the whole match. No
      // genome data in the log — only the error name/message (Tier-1 safe).
      const name = recordErr instanceof Error ? recordErr.name : "UnknownError";
      const message =
        recordErr instanceof Error ? recordErr.message : String(recordErr);
      console.error(
        `[clinvar-disease-matcher] skipped malformed ClinVar record: ${name}: ${message}`,
      );
      continue;
    }
  }

  return findings;
}
