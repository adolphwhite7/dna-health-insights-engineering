import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { constitutionSourcesFor } from "./constitution";
import {
  CUSTOMER_CHAT_MAX_SOURCE_EXCERPTS,
  CUSTOMER_CHAT_MAX_CONTEXT_CHARS,
} from "./policy";
import { populationMarkersFrom } from "./routing";
import {
  CustomerChatError,
  type ApprovedSourceExcerpt,
  type ApprovedSourceResolution,
  type SubjectClass,
} from "./types";

type Row = Record<string, unknown>;

interface DeliveredReportResolution {
  sources: ApprovedSourceExcerpt[];
  identityRedactions: string[];
}

interface ReportEvidence {
  sources: ApprovedSourceExcerpt[];
  confirmedMarkers: string[];
  readyLookupMarkers: string[];
  identityRedactions: string[];
  ambiguous: boolean;
  structuredIdentityMatched: boolean;
}

interface SafeFindingIdentity {
  reportId: string;
  gene: string | null;
  variantLabel: string | null;
  rsid: string | null;
  genotype: string | null;
}

type ReportEvidenceMode = "CURRENT" | "HISTORICAL";

const REPORT_KIND_LABELS: Record<string, string> = {
  clinical_overview: "Clinical Overview",
  educational_summary: "Educational Summary",
  full_report: "Full Report",
  supplement_interaction: "Medication & Your Genes",
  summary: "Summary",
  welcome_reading: "Welcome Reading",
};

const CURRENT_FINDING_CANDIDATE_LIMIT = 24;
const HISTORICAL_FINDING_CANDIDATE_LIMIT = 48;
const CUSTOMER_VISIBLE_IDENTITY_LIMIT = 6;
const STRUCTURED_IDENTITY_JSON_KEYS = {
  rsid: ["rsid", "rs_id", "rsID"],
  genotype: ["genotype", "geno", "marker_state", "markerState"],
} as const;

function reportKindLabel(value: unknown): string {
  return typeof value === "string"
    ? REPORT_KIND_LABELS[value] ?? "Generated Report"
    : "Generated Report";
}

function identityRedactionsFrom(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.normalize("NFKC").trim())
    .filter(
      (value, index, candidates) =>
        value.length >= 2 &&
        value.length <= 120 &&
        LIKELY_PERSON_NAME_PATTERN.test(value) &&
        candidates.indexOf(value) === index,
    )
    .slice(0, 32);
}

const EXCLUDED_JSON_KEYS = /(?:model|prompt|token|hash|provider|provenance|gate|request|fingerprint|internal|metadata)/i;
const EXCLUDED_IDENTITY_KEYS = /^(?:name|first_name|last_name|full_name|email|subject_name|patient_name|customer_name|user_id|account_id)$/i;
const SEARCH_STOP_WORDS = new Set([
  "about",
  "does",
  "educational",
  "explain",
  "finding",
  "generated",
  "have",
  "help",
  "mine",
  "please",
  "report",
  "says",
  "summary",
  "that",
  "this",
  "understand",
  "what",
  "with",
  "your",
]);

function searchTerms(question: string): string[] {
  const rsids = question.match(/\brs\d{3,12}\b/gi) ?? [];
  const genes = question.match(/\b[A-Z][A-Z0-9-]{2,11}\b/g) ?? [];
  const words = question
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{3,}/g)
    ?.filter((word) => !SEARCH_STOP_WORDS.has(word)) ?? [];
  return [...new Set([...rsids.map((value) => value.toLowerCase()), ...genes, ...words])].slice(0, 5);
}

const MAX_SOURCE_STRING_CHARS = 3_000;
const LIKELY_PERSON_NAME_PATTERN = /^(?:\p{Lu}(?:[\p{Ll}\p{M}]{1,40}|(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]{1,40})+)(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]{1,40})*|\p{Lu}\.)(?:\s+(?:\p{Lu}(?:[\p{Ll}\p{M}]{1,40}|(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]{1,40})+)(?:['’\-]\p{Lu}?[\p{Ll}\p{M}]{1,40})*|\p{Lu}\.|(?:Jr|Sr|II|III|IV)\.?)){1,4}$/u;

function boundedStringExcerpt(
  value: string,
  terms: string[],
  allowLeadingWindow: boolean,
): string {
  const text = value.trim();
  if (text.length <= MAX_SOURCE_STRING_CHARS) return text;
  const lower = text.toLowerCase();
  const matchIndex = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (matchIndex === undefined && !allowLeadingWindow) return "";
  const start = Math.max(0, (matchIndex ?? 0) - 750);
  return text.slice(start, start + MAX_SOURCE_STRING_CHARS).trim();
}

function collectCustomerText(
  value: unknown,
  terms: string[],
  allowLeadingWindow: boolean,
  key = "",
  out: string[] = [],
): string[] {
  if (EXCLUDED_JSON_KEYS.test(key) || EXCLUDED_IDENTITY_KEYS.test(key)) return out;
  if (typeof value === "string") {
    const text = boundedStringExcerpt(value, terms, allowLeadingWindow);
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      collectCustomerText(item, terms, allowLeadingWindow, key, out);
    }
    return out;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value as Row)) {
      collectCustomerText(child, terms, allowLeadingWindow, childKey, out);
      if (out.join("\n").length >= 8_000) break;
    }
  }
  return out;
}

function excerptText(
  value: unknown,
  terms: string[],
  allowLeadingWindow: boolean,
): string {
  return [...new Set(collectCustomerText(value, terms, allowLeadingWindow))]
    .join("\n")
    .slice(0, 6_000);
}

function relevanceScore(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function containsMarker(text: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, "i").test(text);
}

function exactMarkersIn(text: string, markers: string[]): string[] {
  return markers.filter((marker) => containsMarker(text, marker));
}

function containsProseMarker(text: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![A-Za-z0-9-])${escaped}(?=$|[^A-Za-z0-9-]|-(?:related|associated|linked|specific|based|mediated)\\b)`,
    "i",
  ).test(text);
}

function proseMarkersIn(text: string, markers: string[]): string[] {
  return markers.filter((marker) => containsProseMarker(text, marker));
}

function safeIlikeTerm(term: string): string {
  return term.replace(/[%_,().]/g, "").slice(0, 32);
}

function boundedIdentityString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function genotypeKey(value: unknown): string | null {
  const normalized = boundedIdentityString(value, 8)?.toUpperCase().replace(/[\/|]/g, "") ?? "";
  return /^[ACGT]{2}$/.test(normalized) ? normalized : null;
}

function genotypeDisplay(value: string): string {
  return value.split("").join("/");
}

function isGenotypeMarker(value: string): boolean {
  return genotypeKey(value) !== null;
}

function genotypeQueryAliases(value: string): string[] {
  const key = genotypeKey(value);
  if (!key) return [];
  return [key, key.split("").join("/"), key.split("").join("|")];
}

function safeFindingIdentity(row: Row): SafeFindingIdentity {
  const details = row.findings_json && typeof row.findings_json === "object" && !Array.isArray(row.findings_json)
    ? row.findings_json as Row
    : {};
  const firstAllowed = (keys: readonly string[]) => {
    for (const key of keys) {
      const value = boundedIdentityString(details[key], 120);
      if (value) return value;
    }
    return null;
  };
  const gene = boundedIdentityString(row.gene, 32) ?? boundedIdentityString(details.gene, 32);
  const variantLabel = boundedIdentityString(row.variant_label);
  const rsid = (
    firstAllowed(STRUCTURED_IDENTITY_JSON_KEYS.rsid) ??
    variantLabel?.match(/\brs\d{1,15}\b/i)?.[0] ??
    null
  )?.toLowerCase() ?? null;
  const labelGenotype = variantLabel?.match(/(?:^|\s)([ACGT]{2}|[ACGT][\/|][ACGT])(?:$|\s|[),.;])/i)?.[1];
  return {
    reportId: boundedIdentityString(row.report_id, 64) ?? "",
    gene: gene?.toUpperCase() ?? null,
    variantLabel,
    rsid: rsid && /^rs\d{1,15}$/.test(rsid) ? rsid : null,
    genotype: genotypeKey(firstAllowed(STRUCTURED_IDENTITY_JSON_KEYS.genotype) ?? labelGenotype),
  };
}

function identityText(identity: SafeFindingIdentity): string {
  const parts = [
    identity.gene,
    identity.rsid,
    identity.genotype ? genotypeDisplay(identity.genotype) : null,
    !identity.gene && !identity.rsid ? identity.variantLabel : null,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(parts)].join(" ");
}

function identityKey(identity: SafeFindingIdentity): string {
  const core = [identity.gene, identity.rsid, identity.genotype];
  return [...core, core.some(Boolean) ? null : identity.variantLabel]
    .map((value) => value?.toLowerCase() ?? "")
    .join("|");
}

function markerMatchesIdentity(marker: string, identity: SafeFindingIdentity): boolean {
  if (/^rs\d{1,15}$/i.test(marker)) return identity.rsid === marker.toLowerCase();
  const genotype = genotypeKey(marker);
  if (genotype) return identity.genotype === genotype;
  return containsMarker([identity.gene, identity.variantLabel].filter(Boolean).join(" "), marker);
}

function exactIdentityMarkers(identity: SafeFindingIdentity, markers: string[]): string[] {
  return markers.filter((marker) => markerMatchesIdentity(marker, identity));
}

function identityMatchesRequest(identity: SafeFindingIdentity, markers: string[]): boolean {
  const compoundIdentity = markers.length > 1 && markers.some(
    (marker) => isGenotypeMarker(marker) || /^rs\d{1,15}$/i.test(marker),
  );
  return compoundIdentity
    ? markers.every((marker) => markerMatchesIdentity(marker, identity))
    : exactIdentityMarkers(identity, markers).length > 0;
}

function readyIdentityMarkers(identity: SafeFindingIdentity): string[] {
  const markers = identity.rsid
    ? [identity.gene, identity.rsid]
    : identity.genotype
      ? [identity.gene, genotypeDisplay(identity.genotype)]
      : [identity.gene, identity.variantLabel];
  return markers.filter((value): value is string => Boolean(value));
}

function readySourcesForIdentity(
  sources: ApprovedSourceExcerpt[],
  markers: string[],
): ApprovedSourceExcerpt[] {
  if (markers.length === 0) return [];
  const matches = (source: ApprovedSourceExcerpt, required: string[]) => {
    const text = `${source.title}\n${source.text}`;
    return required.every(
      (marker) => containsMarker(text, marker) || containsProseMarker(text, marker),
    );
  };
  const exact = sources.filter((source) => matches(source, markers));
  if (exact.length > 0) return exact;
  const gene = markers.find((marker) => !/^rs\d{1,15}$/i.test(marker) && !isGenotypeMarker(marker));
  if (!gene) return [];
  const geneMatches = sources.filter((source) => matches(source, [gene]));
  return geneMatches.length === 1 ? geneMatches : [];
}

function findingCandidateSelectors(markers: string[]): string[] {
  return [...new Set(markers.flatMap((marker) => {
    if (/^rs\d{1,15}$/i.test(marker)) {
      const term = safeIlikeTerm(marker.toLowerCase());
      return [
        ...STRUCTURED_IDENTITY_JSON_KEYS.rsid.map((key) => `findings_json->>${key}.ilike.${term}`),
        `variant_label.ilike.%${term}%`,
      ];
    }
    if (isGenotypeMarker(marker)) {
      return genotypeQueryAliases(marker).flatMap((alias) => [
        ...STRUCTURED_IDENTITY_JSON_KEYS.genotype.map(
          (key) => `findings_json->>${key}.ilike.${safeIlikeTerm(alias)}`,
        ),
        `variant_label.ilike.%${safeIlikeTerm(alias)}%`,
      ]);
    }
    const term = safeIlikeTerm(marker);
    if (!term) return [];
    return [
      `gene.ilike.${term}`,
      `variant_label.ilike.%${term}%`,
      `findings_json->>gene.ilike.${term}`,
    ];
  }))];
}

function uniqueIdentities(identities: SafeFindingIdentity[]): SafeFindingIdentity[] {
  return identities.filter(
    (identity, index, values) =>
      values.findIndex((candidate) => identityKey(candidate) === identityKey(identity)) === index,
  );
}

function reportDateContext(report: Row): string {
  const value = boundedIdentityString(report.generated_at, 40) ?? boundedIdentityString(report.created_at, 40);
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "an earlier date";
}

function explicitRecordRef(question: string): string | null {
  return question.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ?? null;
}

export interface ApprovedSourceResolver {
  resolve(ownerId: string, question: string, subject: SubjectClass): Promise<ApprovedSourceResolution>;
}

export class SupabaseApprovedSourceResolver implements ApprovedSourceResolver {
  constructor(private readonly adminClient: SupabaseClient) {}

  private async deliveredReports(
    ownerId: string,
    terms: string[],
    recordRef: string | null,
    markers: string[],
    allowInventoryFallback: boolean,
  ): Promise<DeliveredReportResolution> {
    let reportsQuery = this.adminClient
      .from("reports")
      .select("id,subject_name,narrative_json,generated_at,report_kind")
      .eq("user_id", ownerId)
      .eq("report_status", "delivered")
      .order("generated_at", { ascending: false })
      .limit(recordRef ? 1 : 12);
    if (recordRef) reportsQuery = reportsQuery.eq("id", recordRef);
    const { data: reports, error } = await reportsQuery;
    if (error) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    if (!reports?.length) return { sources: [], identityRedactions: [] };
    const reportIds = reports.map((row) => String(row.id));
    const { data: narratives, error: narrativesError } = await this.adminClient
      .from("narrative_reports")
      .select("id,report_id,subject_name,narrative_report,generated_at")
      .eq("user_id", ownerId)
      .in("report_id", reportIds)
      .order("generated_at", { ascending: false })
      .limit(Math.min(reportIds.length * 3, 36));
    if (narrativesError) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    const byReport = new Map<string, Row>();
    for (const narrative of (narratives ?? []) as unknown as Row[]) {
      const reportId = String(narrative.report_id);
      if (!byReport.has(reportId)) byReport.set(reportId, narrative);
    }
    const identityRedactions = identityRedactionsFrom([
      ...reports.map((report) => report.subject_name),
      ...[...byReport.values()].map((narrative) => narrative.subject_name),
    ]);
    const sources = reports
      .map((report) => {
        const narrative = byReport.get(String(report.id));
        const text = excerptText(
          narrative?.narrative_report ?? report.narrative_json,
          terms,
          recordRef !== null || allowInventoryFallback,
        );
        const title = String(narrative?.subject_name ?? report.subject_name ?? "Generated report");
        return {
          ref: `delivered-report:${report.id}`,
          kind: "DELIVERED_REPORT" as const,
          title: `${reportKindLabel(report.report_kind)} excerpt`,
          text,
          score: relevanceScore(`${title}\n${text}`, terms),
        };
      })
      .filter(
        (entry) =>
          entry.text &&
          (markers.length > 0
            ? exactMarkersIn(entry.title, markers).length > 0 || proseMarkersIn(entry.text, markers).length > 0
            : recordRef !== null || allowInventoryFallback || entry.score > 0),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(({ ref, kind, title, text }) => ({ ref, kind, title, text }));
    return { sources, identityRedactions };
  }

  private async selectedCurrentReport(
    ownerId: string,
    recordRef: string | null,
  ): Promise<Row | null> {
    let query = this.adminClient
      .from("reports")
      .select("id,subject_name,narrative_json,generated_at,created_at,report_kind")
      .eq("user_id", ownerId)
      .eq("report_status", "delivered")
      .eq("report_kind", "full_report");
    if (recordRef) {
      query = query.eq("id", recordRef).limit(1);
    } else {
      query = query
        .order("generated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
    }
    const { data, error } = await query;
    if (error) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    return ((data ?? []) as unknown as Row[])[0] ?? null;
  }

  private async reportEvidence(
    userId: string,
    report: Row,
    markers: string[],
    mode: ReportEvidenceMode,
    knownStructuredRows?: Row[],
  ): Promise<ReportEvidence> {
    const reportId = String(report.id);
    const { data: narratives, error: narrativeError } = await this.adminClient
      .from("narrative_reports")
      .select("subject_name,narrative_report,generated_at")
      .eq("user_id", userId)
      .eq("report_id", reportId)
      .order("generated_at", { ascending: false })
      .limit(1);
    if (narrativeError) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    const narrativeRow = ((narratives ?? []) as unknown as Row[])[0];
    const narrative = narrativeRow?.narrative_report ?? report.narrative_json;
    const narrativeText = excerptText(narrative, markers, false);
    const narrativeMarkers = proseMarkersIn(narrativeText, markers);
    const missingMarkers = markers.filter(
      (marker) => !narrativeMarkers.some((found) => found.toLowerCase() === marker.toLowerCase()),
    );
    let rows: Row[] = knownStructuredRows ?? [];
    if (markers.length > 0 && !knownStructuredRows) {
      const selectors = findingCandidateSelectors(markers);
      const { data, error } = await this.adminClient
        .from("structured_findings")
        .select("report_id,gene,variant_label,findings_json,generated_at")
        .eq("user_id", userId)
        .eq("report_id", reportId)
        .or(selectors.join(","))
        .order("generated_at", { ascending: false })
        .order("gene", { ascending: true })
        .order("variant_label", { ascending: true })
        .limit(CURRENT_FINDING_CANDIDATE_LIMIT);
      if (error) {
        throw new CustomerChatError(
          "SOURCE_UNAVAILABLE",
          503,
          "The approved source context is temporarily unavailable.",
          true,
        );
      }
      rows = (data ?? []) as unknown as Row[];
    }
    const matchingIdentities = rows
      .map(safeFindingIdentity)
      .filter((identity) => identityMatchesRequest(identity, markers));
    const structuredMarkers = missingMarkers.filter((marker) =>
      matchingIdentities.some((identity) => markerMatchesIdentity(marker, identity)),
    );
    const confirmedMarkers = [...narrativeMarkers, ...structuredMarkers].filter(
      (marker, index, values) =>
        values.findIndex((candidate) => candidate.toLowerCase() === marker.toLowerCase()) === index,
    );
    const distinctIdentities = uniqueIdentities(matchingIdentities);
    const readyLookupMarkers = distinctIdentities.length === 1
      ? readyIdentityMarkers(distinctIdentities[0])
      : [];
    const sources: ApprovedSourceExcerpt[] = [];
    if (narrativeMarkers.length > 0) {
      sources.push({
        ref: `${mode === "CURRENT" ? "current" : "generated"}-report:${reportId}`,
        kind: "DELIVERED_REPORT",
        title: mode === "CURRENT"
          ? "Current generated report excerpt"
          : `Earlier ${reportKindLabel(report.report_kind)} excerpt (${reportDateContext(report)})`,
        text: narrativeText,
      });
    }
    if (structuredMarkers.length > 0) {
      const safeIdentities = uniqueIdentities(matchingIdentities)
        .map(identityText)
        .filter(Boolean)
        .slice(0, CUSTOMER_VISIBLE_IDENTITY_LIMIT);
      sources.push({
        ref: `${mode === "CURRENT" ? "current" : "generated"}-report-membership:${reportId}`,
        kind: "DELIVERED_REPORT",
        title: mode === "CURRENT"
          ? "Current generated report membership"
          : `Earlier generated report membership (${reportDateContext(report)})`,
        text: mode === "CURRENT"
          ? `The current generated report contains: ${safeIdentities.join("; ")}.`
          : `An earlier delivered ${reportKindLabel(report.report_kind)} from ${reportDateContext(report)} contains: ${safeIdentities.join("; ")}. This does not establish that the finding is in the current report.`,
      });
    }
    const bareGenotype = markers.length === 1 && isGenotypeMarker(markers[0]);
    const currentCandidateLimitReached = knownStructuredRows === undefined &&
      rows.length >= CURRENT_FINDING_CANDIDATE_LIMIT;
    const ambiguous = bareGenotype &&
      (distinctIdentities.length > 1 || currentCandidateLimitReached);
    if (ambiguous) {
      const identities = distinctIdentities
        .map(identityText)
        .filter(Boolean)
        .slice(0, CUSTOMER_VISIBLE_IDENTITY_LIMIT);
      const ambiguityText = distinctIdentities.length > 1
        ? `Multiple generated findings match genotype ${genotypeDisplay(genotypeKey(markers[0])!)}: ${identities.join("; ")}. Ask which gene or rsID the customer wants explained.`
        : distinctIdentities.length === 1
          ? `The bounded search found genotype ${genotypeDisplay(genotypeKey(markers[0])!)} in generated findings including: ${identities.join("; ")}. More matching findings may exist, so ask which gene or rsID the customer wants explained.`
          : `The bounded search for genotype ${genotypeDisplay(genotypeKey(markers[0])!)} reached its limit without establishing one generated finding. Ask which gene or rsID the customer wants explained.`;
      return {
        sources: [{
          ref: `${mode === "CURRENT" ? "current" : "generated"}-report-membership:multiple`,
          kind: "DELIVERED_REPORT",
          title: mode === "CURRENT"
            ? "Current generated report matches needing clarification"
            : "Generated report matches needing clarification",
          text: ambiguityText,
        }],
        confirmedMarkers,
        readyLookupMarkers: [],
        identityRedactions: identityRedactionsFrom([report.subject_name, narrativeRow?.subject_name]),
        ambiguous: true,
        structuredIdentityMatched: matchingIdentities.length > 0,
      };
    }
    return {
      sources,
      confirmedMarkers,
      readyLookupMarkers,
      identityRedactions: identityRedactionsFrom([report.subject_name, narrativeRow?.subject_name]),
      ambiguous: false,
      structuredIdentityMatched: matchingIdentities.length > 0,
    };
  }

  private async historicalReportEvidence(
    userId: string,
    currentReportId: string | null,
    markers: string[],
  ): Promise<ReportEvidence> {
    const selectors = findingCandidateSelectors(markers);
    if (selectors.length === 0) {
      return { sources: [], confirmedMarkers: [], readyLookupMarkers: [], identityRedactions: [], ambiguous: false, structuredIdentityMatched: false };
    }
    let reportsQuery = this.adminClient
      .from("reports")
      .select("id,subject_name,narrative_json,generated_at,created_at,report_kind")
      .eq("user_id", userId)
      .eq("report_status", "delivered")
      .eq("report_kind", "full_report");
    if (currentReportId) {
      reportsQuery = reportsQuery.neq("id", currentReportId);
    }
    const { data: reports, error: reportsError } = await reportsQuery
      .order("generated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORICAL_FINDING_CANDIDATE_LIMIT);
    if (reportsError) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    const eligibleReports = (reports ?? []) as unknown as Row[];
    const eligibleReportIds = eligibleReports.map((report) => String(report.id)).filter(Boolean);
    if (eligibleReportIds.length === 0) {
      return { sources: [], confirmedMarkers: [], readyLookupMarkers: [], identityRedactions: [], ambiguous: false, structuredIdentityMatched: false };
    }
    const candidateQuery = this.adminClient
      .from("structured_findings")
      .select("report_id,gene,variant_label,findings_json,generated_at")
      .eq("user_id", userId)
      .in("report_id", eligibleReportIds)
      .or(selectors.join(","));
    const { data, error } = await candidateQuery
      .order("generated_at", { ascending: false })
      .order("report_id", { ascending: false })
      .order("gene", { ascending: true })
      .order("variant_label", { ascending: true })
      .limit(HISTORICAL_FINDING_CANDIDATE_LIMIT);
    if (error) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    const candidateRows = (data ?? []) as unknown as Row[];
    const candidateLimitReached = candidateRows.length >= HISTORICAL_FINDING_CANDIDATE_LIMIT;
    const matchingRows = candidateRows.filter((row) =>
      identityMatchesRequest(safeFindingIdentity(row), markers),
    );
    const bareGenotype = markers.length === 1 && isGenotypeMarker(markers[0]);
    if (matchingRows.length === 0) {
      if (bareGenotype && candidateLimitReached) {
        return {
          sources: [{
            ref: "generated-report-membership:bounded",
            kind: "DELIVERED_REPORT",
            title: "Generated report matches needing clarification",
            text: `The bounded search for genotype ${genotypeDisplay(genotypeKey(markers[0])!)} reached its limit without establishing one generated finding. Ask which gene or rsID the customer wants explained.`,
          }],
          confirmedMarkers: [markers[0]],
          readyLookupMarkers: [],
          identityRedactions: [],
          ambiguous: true,
          structuredIdentityMatched: false,
        };
      }
      return { sources: [], confirmedMarkers: [], readyLookupMarkers: [], identityRedactions: [], ambiguous: false, structuredIdentityMatched: false };
    }
    const eligibleIdentities = uniqueIdentities(
      matchingRows.map(safeFindingIdentity),
    );
    if (eligibleIdentities.length === 0) {
      if (bareGenotype && candidateLimitReached) {
        return {
          sources: [{
            ref: "generated-report-membership:bounded",
            kind: "DELIVERED_REPORT",
            title: "Generated report matches needing clarification",
            text: `The bounded search for genotype ${genotypeDisplay(genotypeKey(markers[0])!)} reached its limit without establishing one eligible delivered finding. Ask which gene or rsID the customer wants explained.`,
          }],
          confirmedMarkers: [markers[0]],
          readyLookupMarkers: [],
          identityRedactions: identityRedactionsFrom(eligibleReports.map((report) => report.subject_name)),
          ambiguous: true,
          structuredIdentityMatched: false,
        };
      }
      return { sources: [], confirmedMarkers: [], readyLookupMarkers: [], identityRedactions: [], ambiguous: false, structuredIdentityMatched: false };
    }
    if (
      bareGenotype &&
      (eligibleIdentities.length > 1 || candidateLimitReached)
    ) {
      const identities = eligibleIdentities
        .map(identityText)
        .filter(Boolean)
        .slice(0, CUSTOMER_VISIBLE_IDENTITY_LIMIT);
      const ambiguityText = eligibleIdentities.length > 1
        ? `Multiple delivered generated-report findings match genotype ${genotypeDisplay(genotypeKey(markers[0])!)}: ${identities.join("; ")}. Ask which gene or rsID the customer wants explained.`
        : `The bounded search found genotype ${genotypeDisplay(genotypeKey(markers[0])!)} in delivered generated-report findings including: ${identities.join("; ")}. More matching findings may exist, so ask which gene or rsID the customer wants explained.`;
      return {
        sources: [{
          ref: "generated-report-membership:multiple",
          kind: "DELIVERED_REPORT",
          title: "Generated report matches needing clarification",
          text: ambiguityText,
        }],
        confirmedMarkers: [markers[0]],
        readyLookupMarkers: [],
        identityRedactions: identityRedactionsFrom(eligibleReports.map((report) => report.subject_name)),
        ambiguous: true,
        structuredIdentityMatched: true,
      };
    }
    const matchingReportIds = new Set(matchingRows.map((row) => String(row.report_id)));
    const selectedReport = eligibleReports.find((report) => matchingReportIds.has(String(report.id)));
    const selectedRows = selectedReport
      ? matchingRows.filter((row) => String(row.report_id) === String(selectedReport.id))
      : [];
    return selectedReport
      ? this.reportEvidence(userId, selectedReport, markers, "HISTORICAL", selectedRows)
      : { sources: [], confirmedMarkers: [], readyLookupMarkers: [], identityRedactions: [], ambiguous: false, structuredIdentityMatched: false };
  }

  private async readyFindingRows(
    ownerId: string,
    table: "command_center_finding_bodies" | "performance_suite_finding_bodies" | "supplement_finding_bodies",
    identityColumns: string[],
    terms: string[],
    recordRef: string | null,
  ): Promise<Row[]> {
    const selectors = terms
      .flatMap((term) => identityColumns.map((column) => `${column}.ilike.%${safeIlikeTerm(term)}%`))
      .filter((selector) => !selector.endsWith(".%%"));
    if (!recordRef && selectors.length === 0) return [];
    let query = this.adminClient
      .from(table)
      .select(`id,${identityColumns.join(",")},body_json,updated_at`)
      .eq("user_id", ownerId)
      .eq("status", "ready")
      .eq("generation_mode", "model_backed")
      .eq("generation_in_progress", false)
      .order("updated_at", { ascending: false })
      .limit(3);
    query = recordRef ? query.eq("id", recordRef) : query.or(selectors.join(","));
    const { data, error } = await query;
    if (error) {
      throw new CustomerChatError(
        "SOURCE_UNAVAILABLE",
        503,
        "The approved source context is temporarily unavailable.",
        true,
      );
    }
    return (data ?? []) as unknown as Row[];
  }

  private async readyFindings(
    ownerId: string,
    terms: string[],
    recordRef: string | null,
  ): Promise<ApprovedSourceExcerpt[]> {
    const [command, performance, supplement] = await Promise.all([
      this.readyFindingRows(
        ownerId,
        "command_center_finding_bodies",
        ["stable_finding_key", "finding_id"],
        terms,
        recordRef,
      ),
      this.readyFindingRows(
        ownerId,
        "performance_suite_finding_bodies",
        ["stable_finding_key"],
        terms,
        recordRef,
      ),
      this.readyFindingRows(
        ownerId,
        "supplement_finding_bodies",
        ["supplement_id"],
        terms,
        recordRef,
      ),
    ]);
    const mapRows = (
      rows: Row[],
      kind: ApprovedSourceExcerpt["kind"],
      prefix: string,
      titleKey: string,
    ) =>
      rows.map((row) => ({
        ref: `${prefix}:${String(row.id)}`,
        kind,
        title: String(row[titleKey] ?? "Generated finding"),
        text: excerptText(row.body_json, terms, recordRef !== null),
      }));
    return [
      ...mapRows(command, "COMMAND_CENTER_FINDING", "command-center-finding", "finding_id"),
      ...mapRows(performance, "PERFORMANCE_SUITE_FINDING", "performance-finding", "stable_finding_key"),
      ...mapRows(supplement, "SUPPLEMENT_FINDING", "supplement-finding", "supplement_id"),
    ].filter((entry) => entry.text);
  }

  async resolve(ownerId: string, question: string, subject: SubjectClass) {
    const constitution = constitutionSourcesFor(subject);
    const terms = searchTerms(question);
    let markers = populationMarkersFrom(question);
    const recordRef = explicitRecordRef(question);
    let accountSources: ApprovedSourceExcerpt[] = [];
    let identityRedactions: string[] = [];
    let explicitRecordFound = false;
    if (
      subject === "DELIVERED_REPORT" ||
      subject === "READY_FINDING" ||
      subject === "MEDICAL_OR_DOSING"
    ) {
      const delivered = await this.deliveredReports(
        ownerId,
        terms,
        recordRef,
        markers,
        subject === "DELIVERED_REPORT" && markers.length === 0,
      );
      accountSources = delivered.sources;
      identityRedactions = delivered.identityRedactions;
    }
    if (subject === "READY_FINDING" || subject === "MEDICAL_OR_DOSING") {
      const explicitReport = recordRef
        ? await this.selectedCurrentReport(ownerId, recordRef)
        : null;
      const explicitFindings = recordRef && !explicitReport
        ? await this.readyFindings(ownerId, markers, recordRef)
        : [];
      explicitRecordFound = Boolean(explicitReport || explicitFindings.length > 0);
      if (markers.length === 0 && explicitFindings.length > 0) {
        markers = explicitFindings
          .flatMap((source) => populationMarkersFrom(`${source.title}\n${source.text}`))
          .filter(
            (marker, index, values) =>
              values.findIndex((candidate) => candidate.toLowerCase() === marker.toLowerCase()) === index,
          );
      }
      if (markers.length > 0) {
        const currentReport = explicitReport ??
          ((!recordRef || explicitFindings.length > 0)
            ? await this.selectedCurrentReport(ownerId, null)
            : null);
        if (currentReport) {
          const current = await this.reportEvidence(ownerId, currentReport, markers, "CURRENT");
          identityRedactions = identityRedactionsFrom([
            ...identityRedactions,
            ...current.identityRedactions,
          ]);
          let evidence = current;
          if (!explicitReport && !current.ambiguous && !current.structuredIdentityMatched) {
            const historical = await this.historicalReportEvidence(ownerId, String(currentReport.id), markers);
            if (historical.confirmedMarkers.length > 0 || historical.ambiguous) {
              evidence = historical;
            }
          }
          identityRedactions = identityRedactionsFrom([
            ...identityRedactions,
            ...evidence.identityRedactions,
          ]);
          const ready = evidence.confirmedMarkers.length > 0 && !evidence.ambiguous
            ? readySourcesForIdentity(
                explicitFindings.length > 0
                  ? explicitFindings
                  : await this.readyFindings(ownerId, evidence.readyLookupMarkers, null),
                evidence.readyLookupMarkers,
              )
            : [];
          accountSources = [
            ...evidence.sources,
            ...ready,
          ];
        } else if (!recordRef) {
          const historical = await this.historicalReportEvidence(ownerId, null, markers);
          identityRedactions = identityRedactionsFrom([
            ...identityRedactions,
            ...historical.identityRedactions,
          ]);
          const ready = historical.confirmedMarkers.length > 0 && !historical.ambiguous
            ? readySourcesForIdentity(
                await this.readyFindings(ownerId, historical.readyLookupMarkers, null),
                historical.readyLookupMarkers,
              )
            : [];
          accountSources = [...historical.sources, ...ready];
        } else {
          accountSources = [];
        }
      } else if (!recordRef) {
        accountSources = [
          ...accountSources,
          ...(await this.readyFindings(ownerId, terms, recordRef)),
        ];
      } else if (!explicitReport) {
        accountSources = [];
      }
    }
    const generatedRecordState =
      accountSources.length > 0
        ? "EXISTING_GENERATED_RECORD"
        : recordRef &&
            (subject === "DELIVERED_REPORT" ||
              ((subject === "READY_FINDING" || subject === "MEDICAL_OR_DOSING") &&
                !explicitRecordFound))
          ? "FOREIGN_OR_INVALID_RECORD"
          : "NO_GENERATED_RECORD";
    const selected = [...accountSources, ...constitution].slice(0, CUSTOMER_CHAT_MAX_SOURCE_EXCERPTS);
    let remaining = CUSTOMER_CHAT_MAX_CONTEXT_CHARS;
    return {
      sources: selected.map((source) => {
        const text = source.text.slice(0, Math.max(0, remaining));
        remaining -= text.length;
        return { ...source, text };
      }).filter((source) => source.text.length > 0),
      generatedRecordState,
      identityRedactions,
    } satisfies ApprovedSourceResolution;
  }
}
