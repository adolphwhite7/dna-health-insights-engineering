export type PerformanceSubLens = "movement" | "daily_rhythm" | "supplementation";

export type PerformanceClassification = {
  subLens: PerformanceSubLens;
  goalTags: string[];
};

export type CuratedSnpSourceRole =
  | "lifestyle"
  | "clinical"
  | "pharmacogenomic";

const CLINICAL_CURATED_SNP_CATEGORIES = new Set([
  "autoimmune",
  "cardiovascular",
  "inflammation",
  "iron metabolism",
  "respiratory",
]);

export function curatedSnpSourceRole(
  rsid: string,
  category: string,
): CuratedSnpSourceRole {
  const marker = rsid.trim().toLowerCase();
  const sourceCategory = category.trim().toLowerCase();

  if (marker === "rs762551") return "lifestyle";
  if (marker === "rs1801253") return "pharmacogenomic";
  if (sourceCategory === "drug metabolism") return "pharmacogenomic";
  if (CLINICAL_CURATED_SNP_CATEGORIES.has(sourceCategory)) return "clinical";
  return "lifestyle";
}

export function classifyPerformanceFinding(
  category: string,
  description: string,
  sourceHint = "",
): PerformanceClassification {
  const haystack = `${category} ${description}`.toLowerCase();
  const source = sourceHint.toLowerCase();
  if (/\b(?:mthfr|mtr|mtrr|gc|vdr|cbs|rs1801131|rs1801133|rs2282679|rs234706)\b/u.test(source)) {
    return { subLens: "supplementation", goalTags: ["longevity", "energy"] };
  }
  if (/\b(?:comt|cyp1a2|bdnf|rs4680|rs762551|rs6265)\b/u.test(source)) {
    return { subLens: "daily_rhythm", goalTags: ["sleep", "cognition", "energy"] };
  }
  if (/\b(?:actn3|ppara|ppargc1a|ace|rs1815739|rs4253778)\b/u.test(source)) {
    return { subLens: "movement", goalTags: ["weight", "energy"] };
  }
  if (/supplement|vitamin|mineral|folate|methyl|b12|d3|omega/u.test(haystack)) {
    return { subLens: "supplementation", goalTags: ["longevity", "energy"] };
  }
  if (/sleep|circadian|caffeine|stress|mood|focus|cognition|dopamine/u.test(haystack)) {
    return { subLens: "daily_rhythm", goalTags: ["sleep", "cognition", "energy"] };
  }
  if (/fitness|exercise|training|muscle|recovery|weight|metabolism|fat|satiety/u.test(haystack)) {
    return { subLens: "movement", goalTags: ["weight", "energy"] };
  }
  return { subLens: "movement", goalTags: ["energy", "longevity"] };
}

export function isPerformanceOptimizationFinding(category: string, description: string): boolean {
  const haystack = `${category} ${description}`.toLowerCase();
  return /caffeine|sleep|circadian|stress|mood|focus|cognition|dopamine|folate|methyl|b12|vitamin|d3|omega|fitness|exercise|muscle|nutrition|recovery|weight|satiety/u.test(
    haystack,
  );
}

export function isCuratedPharmacogenomicFinding(category: string, description: string): boolean {
  const normalizedCategory = category.toLowerCase();
  const isMedicationOrMetabolism =
    normalizedCategory.includes("drug") || normalizedCategory.includes("metabolism");
  return isMedicationOrMetabolism && !isPerformanceOptimizationFinding(category, description);
}
