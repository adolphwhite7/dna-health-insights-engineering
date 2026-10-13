import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detectFormat, parseGenomeFile, type ParseResult } from "../genome-parser";

// SPEC_RECOMMENDATION: Update Section 11 — adversarial parser testing with 8 malformed file scenarios

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adversarialDir = path.resolve(__dirname, "../../../test-data/adversarial");

const adversarialFiles = [
  "empty.txt",
  "wrong-delimiter.txt",
  "truncated.txt",
  "no-header.txt",
  "mixed-format.txt",
  "binary-junk.txt",
  "sql-injection.txt",
  "huge-rsid.txt",
] as const;

function readAdversarialFile(fileName: (typeof adversarialFiles)[number]): string {
  return readFileSync(path.join(adversarialDir, fileName), "utf8");
}

function parseSafely(fileName: (typeof adversarialFiles)[number]): ParseResult {
  const content = readAdversarialFile(fileName);
  let result: ParseResult | undefined;

  expect(() => {
    result = parseGenomeFile(content);
  }).not.toThrow();

  expect(result).toBeDefined();
  return result as ParseResult;
}

describe("genome parser adversarial malformed files", () => {
  it.each(adversarialFiles)(
    "does not crash or throw unhandled exceptions for %s",
    (fileName) => {
      const result = parseSafely(fileName);

      expect(result.variants).toBeInstanceOf(Map);
      expect(result.count).toBe(result.variants.size);
      expect(result.detection.reason).toEqual(expect.any(String));
      expect(result.detection.reason.length).toBeGreaterThan(0);
      expect(result.detection.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(result.detection.confidenceScore).toBeLessThanOrEqual(100);
    }
  );

  it("returns low-confidence unknown diagnostics for empty input", () => {
    const result = parseSafely("empty.txt");

    expect(result.format).toBe("unknown");
    expect(result.count).toBe(0);
    expect(result.detection.confidence).toBe("low");
    expect(result.detection.confidenceScore).toBe(10);
    expect(result.detection.reason).toContain("No recognized genome file format");
  });

  it("returns low-confidence unknown diagnostics for binary junk", () => {
    const result = parseSafely("binary-junk.txt");

    expect(result.format).toBe("unknown");
    expect(result.count).toBe(0);
    expect(result.detection.confidence).toBe("low");
    expect(result.detection.reason).toContain("No recognized genome file format");
  });

  it("does not parse comma-separated data under a tab-delimited 23andMe header", () => {
    const result = parseSafely("wrong-delimiter.txt");

    expect(result.format).toBe("23andme");
    expect(result.count).toBe(0);
    expect(result.detection.confidence).toBe("high");
    expect(result.detection.reason).toContain("Matched 23andMe column header pattern");
  });

  it("accepts a truncated but syntactically valid 23andMe export without assuming completeness", () => {
    const result = parseSafely("truncated.txt");

    expect(result.format).toBe("23andme");
    expect(result.count).toBe(5);
    expect(result.detection.confidence).toBe("high");
    expect(result.detection.reason).toContain("Found '# 23andMe' identifier");
  });

  it("scores no-header four-column rsid data as medium-confidence ambiguous 23andMe/LivingDNA", () => {
    const content = readAdversarialFile("no-header.txt");
    const detection = detectFormat(content.split(/\r?\n/).slice(0, 30));
    const result = parseSafely("no-header.txt");

    expect(detection.format).toBe("23andme");
    expect(detection.confidence).toBe("medium");
    expect(detection.confidenceScore).toBe(75);
    expect(detection.reason).toContain("likely 23andMe or LivingDNA");
    expect(result.count).toBe(5);
  });

  it("prioritizes explicit headers when the body uses a mixed provider column shape", () => {
    const result = parseSafely("mixed-format.txt");

    expect(result.format).toBe("23andme");
    expect(result.count).toBe(5);
    expect(result.detection.confidence).toBe("high");
    expect(result.detection.reason).toContain("Found '# 23andMe' identifier");
  });

  it("treats SQL injection rsid payloads as inert text and does not execute or throw", () => {
    const result = parseSafely("sql-injection.txt");

    expect(result.format).toBe("23andme");
    expect(result.count).toBe(4);
    expect(result.variants.has("rs123'; DROP TABLE variants;--")).toBe(true);
    expect(result.variants.has("rs456 UNION SELECT * FROM users")).toBe(true);
  });

  it("handles a 10,000-character rsid field without crashing", () => {
    const result = parseSafely("huge-rsid.txt");
    const [rsid] = Array.from(result.variants.keys());

    expect(result.format).toBe("23andme");
    expect(result.count).toBe(1);
    expect(rsid).toHaveLength(10_000);
    expect(rsid.startsWith("rs")).toBe(true);
  });
});
