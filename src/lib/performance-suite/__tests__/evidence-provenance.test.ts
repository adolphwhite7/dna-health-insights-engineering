import { describe, expect, it } from "vitest";
import { deriveEvidenceProvenance, type EvidenceProvenance } from "../evidence-provenance";

describe("deriveEvidenceProvenance", () => {
  describe("ClinVar source class", () => {
    it("maps pathogenic to well-established", () => {
      const result = deriveEvidenceProvenance({
        source: "clinvar",
        clinical_significance: "Pathogenic",
      });
      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        sourceClass: "clinvar",
        settledLevel: "well-established",
      } satisfies Partial<EvidenceProvenance>);
      expect(result!.evidenceHeld).toContain("ClinVar");
      expect(result!.evidenceHeld).toContain("Pathogenic");
    });

    it("maps likely pathogenic to well-established", () => {
      const result = deriveEvidenceProvenance({
        source: "clinvar",
        clinical_significance: "Likely pathogenic",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("well-established");
    });

    it("maps uncertain significance to emerging", () => {
      const result = deriveEvidenceProvenance({
        clinical_significance: "uncertain significance",
      });
      expect(result).not.toBeNull();
      expect(result!.sourceClass).toBe("clinvar");
      expect(result!.settledLevel).toBe("emerging");
    });

    it("maps risk factor to emerging", () => {
      const result = deriveEvidenceProvenance({
        clinical_significance: "risk factor",
      });
      expect(result).not.toBeNull();
      expect(result!.sourceClass).toBe("clinvar");
      expect(result!.settledLevel).toBe("emerging");
    });

    it("maps benign to preliminary", () => {
      const result = deriveEvidenceProvenance({
        source: "clinvar",
        clinical_significance: "benign",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("preliminary");
    });
  });

  describe("PharmGKB source class", () => {
    it("maps 1A to well-established", () => {
      const result = deriveEvidenceProvenance({
        source: "pharmgkb",
        level: "1A",
      });
      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        sourceClass: "pharmgkb",
        settledLevel: "well-established",
        evidenceHeld: "PharmGKB level 1A",
      } satisfies Partial<EvidenceProvenance>);
    });

    it("maps 1B to well-established", () => {
      const result = deriveEvidenceProvenance({
        source: "pharmgkb",
        level: "1B",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("well-established");
    });

    it("maps 2A to emerging", () => {
      const result = deriveEvidenceProvenance({
        evidence_level: "2A",
      });
      expect(result).not.toBeNull();
      expect(result!.sourceClass).toBe("pharmgkb");
      expect(result!.settledLevel).toBe("emerging");
    });

    it("maps 2B to emerging", () => {
      const result = deriveEvidenceProvenance({
        evidenceLevel: "2B",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("emerging");
    });

    it("maps 3 to preliminary", () => {
      const result = deriveEvidenceProvenance({
        source: "pharmgkb",
        level: "3",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("preliminary");
    });

    it("maps 4 to preliminary", () => {
      const result = deriveEvidenceProvenance({
        source: "pharmgkb",
        level: "4",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("preliminary");
    });
  });

  describe("curated source class", () => {
    it("maps pathogenic status to well-established", () => {
      const result = deriveEvidenceProvenance({
        status: "pathogenic",
      });
      expect(result).not.toBeNull();
      expect(result!.sourceClass).toBe("curated");
      expect(result!.settledLevel).toBe("well-established");
    });

    it("maps wellness trait to preliminary", () => {
      const result = deriveEvidenceProvenance({
        classification: "wellness trait",
      });
      expect(result).not.toBeNull();
      expect(result!.sourceClass).toBe("curated");
      expect(result!.settledLevel).toBe("preliminary");
      expect(result!.evidenceHeld).toContain("wellness trait");
    });

    it("maps moderate to emerging", () => {
      const result = deriveEvidenceProvenance({
        status: "moderate impact",
      });
      expect(result).not.toBeNull();
      expect(result!.settledLevel).toBe("emerging");
    });
  });

  describe("no usable evidence signal", () => {
    it("returns null when no significance, level, or source is present", () => {
      const result = deriveEvidenceProvenance({
        gene: "COMT",
        impact_magnitude: 4,
      });
      expect(result).toBeNull();
    });
  });

  describe("evidenceHeld is non-fabricated", () => {
    it("never invents accession numbers or citations", () => {
      const result = deriveEvidenceProvenance({
        source: "clinvar",
        clinical_significance: "drug response",
      });
      expect(result).not.toBeNull();
      const held = result!.evidenceHeld;
      expect(held).toContain("drug response");
      expect(held).not.toMatch(/rs\d+/iu);
      expect(held).not.toMatch(/https?:\/\//iu);
      expect(held).not.toMatch(/doi/iu);
    });

    it("reflects the exact level string for PharmGKB", () => {
      const result = deriveEvidenceProvenance({ level: "2A" });
      expect(result).not.toBeNull();
      expect(result!.evidenceHeld).toBe("PharmGKB level 2A");
    });
  });
});
