/**
 * genome-parser.ts — Browser-side genome file parser.
 *
 * Parses raw consumer DNA files (AncestryDNA, 23andMe, MyHeritage,
 * FamilyTreeDNA, LivingDNA) into a normalized variant map.
 *
 * Includes 3-tier confidence scoring for format detection (DNA-877).
 */

// SPEC_RECOMMENDATION: Update Section 11 — genome parser now includes 3-tier confidence scoring for format detection

export type GenomeFormat =
  | "ancestrydna"
  | "23andme"
  | "myheritage"
  | "ftdna"
  | "livingdna"
  | "unknown";

export const FORMAT_DISPLAY_NAMES: Record<GenomeFormat, string> = {
  ancestrydna: "AncestryDNA",
  "23andme": "23andMe",
  myheritage: "MyHeritage",
  ftdna: "FamilyTreeDNA",
  livingdna: "LivingDNA",
  unknown: "Unknown",
};

export interface VariantInfo {
  chromosome: string;
  position: string;
  genotype: string;
}

/**
 * 3-tier confidence scoring for genome format detection (DNA-877).
 *
 * HIGH (90%+): Explicit header match found (provider name in comments or
 *   provider-specific column header pattern).
 * MEDIUM (70-89%): Column count + delimiter match but no explicit header.
 * LOW (<70%): Generic format detected, user confirmation recommended.
 */
export interface FormatDetectionResult {
  /** Detected provider format key */
  format: GenomeFormat;
  /** Confidence tier: high, medium, or low */
  confidence: "high" | "medium" | "low";
  /** Numeric confidence score 0-100 */
  confidenceScore: number;
  /** Human-readable explanation of why this format was detected */
  reason: string;
}

export interface ParseResult {
  format: GenomeFormat;
  formatDisplayName: string;
  variants: Map<string, VariantInfo>;
  count: number;
  /** Format detection details including confidence scoring (DNA-877) */
  detection: FormatDetectionResult;
}

export interface ParseGenomeOptions {
  fileName?: string;
  formatOverride?: GenomeFormat;
}

const MAX_VARIANTS = 1_000_000;

function normalizeHeader(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map(clean);
}

function splitGenomeLine(line: string): string[] {
  const delimiter = line.includes(",") && !line.includes("\t") ? "," : "\t";
  return parseDelimitedLine(line, delimiter);
}

function markerLooksSupported(marker: string): boolean {
  const normalized = marker.toLowerCase();
  if (normalized === "rsid" || normalized === "marker" || normalized === "markername") {
    return false;
  }
  return normalized.startsWith("rs") || /^i\d+/.test(normalized);
}

function addVariant(
  variants: Map<string, VariantInfo>,
  rsid: string,
  chromosome: string,
  position: string,
  genotype: string,
): void {
  variants.set(rsid, { chromosome, position, genotype });
  if (variants.size > MAX_VARIANTS) {
    throw new Error("Genome file exceeds supported variant count.");
  }
}

/**
 * Detect the consumer DNA service from the first lines of the file,
 * returning a confidence-scored result.
 *
 * Confidence tiers:
 *  - HIGH (90-99): Explicit header/comment match for a known provider.
 *  - MEDIUM (70-85): Column count + delimiter heuristic match.
 *  - LOW (40-60): Has rsid-like data but no clear provider signature.
 */
export function detectFormat(
  firstLines: string[],
  fileName = "",
): FormatDetectionResult {
  const joined = firstLines.join("\n").toLowerCase();
  const lowerFileName = fileName.toLowerCase();
  const hasMyHeritageContext =
    joined.includes("myheritage") || lowerFileName.includes("myheritage");
  const hasFamilyTreeDnaContext =
    joined.includes("familytreedna") ||
    joined.includes("family tree dna") ||
    lowerFileName.includes("familytreedna") ||
    lowerFileName.includes("family_tree_dna") ||
    lowerFileName.includes("ftdna") ||
    lowerFileName.includes("family_finder");
  const hasLivingDnaContext =
    joined.includes("living dna") ||
    joined.includes("livingdna") ||
    lowerFileName.includes("livingdna") ||
    lowerFileName.includes("living_dna");
  const headerRows = firstLines
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map(splitGenomeLine)
    .map((fields) => fields.map(normalizeHeader));

  // --- HIGH confidence: explicit header matches (90%+) ---

  // AncestryDNA — explicit header comment
  if (joined.includes("#ancestrydna"))
    return {
      format: "ancestrydna",
      confidence: "high",
      confidenceScore: 99,
      reason: "Found '#AncestryDNA' identifier in file header comments",
    };

  // MyHeritage — explicit provider name
  if (hasMyHeritageContext)
    return {
      format: "myheritage",
      confidence: "high",
      confidenceScore: 92,
      reason: "Found 'myheritage' reference in file header or filename",
    };

  // LivingDNA — explicit provider name
  if (hasLivingDnaContext)
    return {
      format: "livingdna",
      confidence: "high",
      confidenceScore: 92,
      reason: "Found 'Living DNA' reference in file header or filename",
    };

  // 23andMe — explicit header comment
  if (joined.includes("# 23andme"))
    return {
      format: "23andme",
      confidence: "high",
      confidenceScore: 99,
      reason: "Found '# 23andMe' identifier in file header comments",
    };

  // 23andMe — provider name anywhere in header (may appear in other comment lines)
  if (joined.includes("23andme"))
    return {
      format: "23andme",
      confidence: "high",
      confidenceScore: 92,
      reason: "Found '23andMe' reference in file header",
    };

  // 23andMe — provider-specific column header
  if (joined.includes("rsid\tchromosome\tposition\tgenotype"))
    return {
      format: "23andme",
      confidence: "high",
      confidenceScore: 95,
      reason:
        "Matched 23andMe column header pattern (rsid/chromosome/position/genotype, tab-delimited)",
    };

  // FamilyTreeDNA — explicit provider name
  if (
    hasFamilyTreeDnaContext
  )
    return {
      format: "ftdna",
      confidence: "high",
      confidenceScore: 92,
      reason: "Found 'FamilyTreeDNA' reference in file header or filename",
    };

  // MyHeritage current standard — official five-column tab with spaced allele names.
  if (
    headerRows.some(
      ([a, b, c, d, e]) =>
        a === "rsid" &&
        b === "chromosome" &&
        c === "position" &&
        d === "allele1" &&
        e === "allele2",
    ) &&
    joined.includes("allele 1")
  )
    return {
      format: "myheritage",
      confidence: "high",
      confidenceScore: 95,
      reason:
        "Matched MyHeritage current column header pattern (rsID/chromosome/position/allele 1/allele 2, tab-delimited)",
    };

  // AncestryDNA — provider-specific column header
  if (joined.includes("rsid\tchromosome\tposition\tallele1\tallele2"))
    return {
      format: "ancestrydna",
      confidence: "high",
      confidenceScore: 95,
      reason:
        "Matched AncestryDNA column header pattern (rsid/chromosome/position/allele1/allele2, tab-delimited)",
    };

  // FamilyTreeDNA — official current four-column CSV header when provider context is present.
  if (
    joined.includes("rsid,chromosome,position,result") &&
    hasFamilyTreeDnaContext
  )
    return {
      format: "ftdna",
      confidence: "high",
      confidenceScore: 95,
      reason:
        "Matched FamilyTreeDNA Family Finder column header pattern (rsid/chromosome/position/result, comma-delimited)",
    };

  // MyHeritage legacy — four-column comma with result.
  if (
    joined.includes("rsid,chromosome,position,result") &&
    hasMyHeritageContext
  )
    return {
      format: "myheritage",
      confidence: "high",
      confidenceScore: 90,
      reason:
        "Matched legacy MyHeritage-compatible column header pattern (rsid/chromosome/position/result, comma-delimited)",
    };

  // --- MEDIUM confidence: column count + delimiter heuristic (70-85%) ---

  for (const line of firstLines) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const tabParts = parseDelimitedLine(line.trim(), "\t");
    const csvParts = parseDelimitedLine(line.trim(), ",");

    // 5 tab-delimited columns with rsid → likely AncestryDNA
    if (tabParts.length === 5 && tabParts[0].startsWith("rs"))
      return {
        format: "ancestrydna",
        confidence: "medium",
        confidenceScore: 80,
        reason:
          "5 tab-delimited columns with rsid prefix — likely AncestryDNA (no explicit header found)",
      };

    // 4 tab-delimited columns with rsid → likely 23andMe or LivingDNA
    if (tabParts.length === 4 && tabParts[0].startsWith("rs"))
      return {
        format: "23andme",
        confidence: "medium",
        confidenceScore: 75,
        reason:
          "4 tab-delimited columns with rsid prefix — likely 23andMe or LivingDNA (no explicit header found)",
      };

    // 4 comma-delimited columns with rsid → provider-ambiguous
    if (
      csvParts.length === 4 &&
      csvParts[0].replace(/"/g, "").startsWith("rs")
    )
      return {
        format: "unknown",
        confidence: "low",
        confidenceScore: 45,
        reason:
          "4 comma-delimited columns with rsid prefix could be MyHeritage legacy or FamilyTreeDNA Family Finder — provider confirmation recommended",
      };

    // 5 comma-delimited columns with rsid → likely FamilyTreeDNA
    if (
      csvParts.length === 5 &&
      csvParts[0].replace(/"/g, "").startsWith("rs")
    )
      return {
        format: "ftdna",
        confidence: "medium",
        confidenceScore: 78,
        reason:
          "5 comma-delimited columns with rsid prefix — likely FamilyTreeDNA (no explicit header found)",
      };

    break;
  }

  // --- LOW confidence: generic / unknown ---

  // Check if there are any rsid-like values at all
  const hasRsid = firstLines.some(
    (l) => !l.startsWith("#") && /\brs\d+\b/.test(l)
  );

  if (hasRsid)
    return {
      format: "unknown",
      confidence: "low",
      confidenceScore: 40,
      reason:
        "File contains rsid-like identifiers but no recognized provider signature or column pattern — user confirmation recommended",
    };

  return {
    format: "unknown",
    confidence: "low",
    confidenceScore: 10,
    reason:
      "No recognized genome file format markers found — file may not be a consumer DNA export",
  };
}

function clean(val: string): string {
  return val.trim().replace(/^"|"$/g, "").trim();
}

/**
 * Parse a raw genome file into a normalized variant map.
 * Works entirely in the browser — no server calls.
 */
export function parseGenomeFile(
  content: string,
  options: ParseGenomeOptions = {},
): ParseResult {
  const lines = content.split(/\r?\n/);
  const headerLines = lines.slice(0, 30);
  const detection = options.formatOverride
    ? {
        format: options.formatOverride,
        confidence: "high" as const,
        confidenceScore: 100,
        reason: "Provider format confirmed by user.",
      }
    : detectFormat(headerLines, options.fileName);
  const format = detection.format;

  const variants = new Map<string, VariantInfo>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const tabParts = parseDelimitedLine(trimmed, "\t");

    if (format === "ancestrydna" && tabParts.length >= 5) {
      const rsid = clean(tabParts[0]);
      if (!markerLooksSupported(rsid)) continue;
      const chrom = clean(tabParts[1]);
      const pos = clean(tabParts[2]);
      const a1 = clean(tabParts[3]);
      const a2 = clean(tabParts[4]);
      if (a1 === "0" || a2 === "0") continue;
      addVariant(variants, rsid, chrom, pos, a1 + a2);
    } else if (format === "23andme" && tabParts.length >= 4) {
      const rsid = clean(tabParts[0]);
      if (!markerLooksSupported(rsid)) continue;
      const chrom = clean(tabParts[1]);
      const pos = clean(tabParts[2]);
      const genotype = clean(tabParts[3]);
      if (genotype === "--" || genotype === "") continue;
      addVariant(variants, rsid, chrom, pos, genotype);
    } else if (
      format === "myheritage" ||
      format === "ftdna" ||
      format === "livingdna"
    ) {
      const csvParts = splitGenomeLine(trimmed);
      if (csvParts.length < 4) continue;
      const rsid = clean(csvParts[0]);
      if (!markerLooksSupported(rsid)) continue;
      const chrom = clean(csvParts[1]);
      const pos = clean(csvParts[2]);
      let genotype: string;
      if (csvParts.length === 4) {
        genotype = clean(csvParts[3]);
      } else if (csvParts.length >= 5) {
        genotype = clean(csvParts[3]) + clean(csvParts[4]);
      } else {
        continue;
      }
      if (genotype === "--" || genotype === "00" || genotype === "") continue;
      addVariant(variants, rsid, chrom, pos, genotype);
    } else if (format === "unknown") {
      // Best-effort parse for low-confidence files. Keep the same count cap as
      // known providers so malformed large files cannot bypass variant limits.
      const parts = splitGenomeLine(trimmed);
      if (parts.length === 5 && markerLooksSupported(clean(parts[0]))) {
        const genotype = clean(parts[3]) + clean(parts[4]);
        if (genotype !== "00" && genotype !== "--") {
          addVariant(variants, clean(parts[0]), clean(parts[1]), clean(parts[2]), genotype);
        }
      } else if (parts.length === 4 && markerLooksSupported(clean(parts[0]))) {
        const genotype = clean(parts[3]);
        if (genotype !== "--" && genotype !== "") {
          addVariant(variants, clean(parts[0]), clean(parts[1]), clean(parts[2]), genotype);
        }
      }
    }
  }

  return {
    format,
    formatDisplayName: FORMAT_DISPLAY_NAMES[format],
    variants,
    count: variants.size,
    detection,
  };
}

/**
 * Convert parsed variants to a basic findings JSON structure.
 * This does NOT include clinical and pharmacogenomic enrichment — that requires
 * the desktop tool or a future browser-side database bundle.
 */
export function variantsToBasicFindings(
  result: ParseResult,
  subjectName?: string
): object {
  const metadata: Record<string, unknown> = {
    source: result.formatDisplayName,
    genome_build: "GRCh37",
    total_variants_analyzed: result.count,
    analysis_date: new Date().toISOString(),
    note: "Basic parse only — no clinical and pharmacogenomic enrichment. Use the desktop analysis tool for full clinical findings.",
  };

  if (subjectName) {
    metadata.subject_name = subjectName;
  }

  return {
    metadata,
    lifestyle: [],
    pharmacogenomics: [],
    clinical: [],
  };
}
