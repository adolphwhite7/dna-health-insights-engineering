# Source and test guide

## What is included

The selection draws implementation and tests from product commit `88d9ab2cc6c4a4de5bd1c3feab6af45accbc3837`. The public export omits the unused competitor-comparison table and replaces obsolete/internal comments in the model resolver, browser store, and ClinVar adapter. Fixture names and an export timestamp are replaced with explicit examples. Selected runtime behavior and the original test assertions are preserved. The public package has its own dependency lock and test configuration. It does not import the original Git history or internal operating records.

| Area | Runnable check | What a passing result establishes |
| --- | --- | --- |
| Genome parsing | [`genome-parser-adversarial.test.ts`](../src/lib/__tests__/genome-parser-adversarial.test.ts) | Defined handling of eight malformed/ambiguous example inputs |
| Structured narration | [`structured-findings-contract.test.ts`](../src/lib/narration/__tests__/structured-findings-contract.test.ts) | Typed request projection, bounded selection, raw-state exclusion, and bulk-finding handling using example data |
| Text projection | [`evidence-projection.test.ts`](../src/lib/narration/__tests__/evidence-projection.test.ts) | Explicit full-text or bounded head/tail projection behavior |
| Evidence provenance | [`evidence-provenance.test.ts`](../src/lib/performance-suite/__tests__/evidence-provenance.test.ts) | Deterministic labels from supplied metadata and no fabricated evidence identifiers |
| Chat routing | [`routing.test.ts`](../src/server/customer-chat/__tests__/routing.test.ts) | Deterministic subject and marker routing for the supplied questions |
| Approved sources | [`sources.test.ts`](../src/server/customer-chat/__tests__/sources.test.ts) | Report ownership filters, identity matching, current/historical precedence, ambiguity, and store-error behavior against database doubles |
| Answer normalization | [`validation.test.ts`](../src/server/customer-chat/__tests__/validation.test.ts) | The selected customer-visible normalization and navigation boundary |

Supporting source includes the enrichment engine, source adapters, browser storage, report-storage helpers, reference verification, tier/model constants, and public product-policy content. These modules help a reviewer follow the original imports and types. Their presence does not mean this package runs their full browser or production workflows.

## Running and interpreting the checks

Follow the clone and installation instructions in the [README](../README.md#run-the-checks). `npm test` runs the seven selected suites with example fixtures and mocked database responses. The test setup rejects unexpected `fetch` calls. `npm run typecheck` checks the implementation; the inherited project convention excludes test files from that separate TypeScript check.

The `server-only` test alias is an empty marker for executing server modules inside the test runner. It is not a production server or a security bypass. No production client is constructed, no provider is called, and no credentials are requested by the test workflow.

`npm ci --ignore-scripts` downloads packages from the npm registry without running dependency lifecycle scripts. The lockfile fixes the dependency versions used for this package. After installation, the documented test workflow is service-independent.

## Public release boundary

Included input files under `test-data/adversarial` are deliberately constructed malformed-input fixtures. In-code report/user IDs and report bodies in the tests are example fixtures used to exercise query behavior. Population-shared variant identifiers and gene symbols in these examples do not identify a customer.

The JSON reference key is the public half of a signature-verification mechanism. The repository does not include its private signing key or reference-data release artifacts.

Excluded from this package: customer genome files and archives, account/report exports, credentials, environment settings, deployment controls, internal handoffs, operational logs, and historical Git objects. Public source inspection does not require these materials.

The product's hosted UI, authentication, billing, model service, database policies, and production deployment are outside this package's runnable scope. Visit [DNA Health Insights](https://www.dna-health-insights.com/) for the product itself. No clinical effectiveness, complete security audit, or fresh production acceptance is claimed by these component checks.
