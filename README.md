# DNA Health Insights — Engineering

**A live consumer genomics product, built around explicit data boundaries and evidence-grounded explanations.**

[Explore DNA Health Insights](https://www.dna-health-insights.com/) · [Architecture and decisions](docs/ARCHITECTURE.md) · [Source and test guide](docs/SOURCE_GUIDE.md)

DNA Health Insights helps people explore information in their consumer DNA results. The engineering challenge extends beyond presenting a model's answer: the system must interpret different input formats, preserve the identity and provenance of findings, control what crosses the browser/server boundary, and select the right evidence when a customer asks about a report.

This repository opens substantial TypeScript implementation from the codebase behind the product. It includes the genome parser, structured report contracts, reference-data adapters, evidence provenance, and the customer-chat source resolver, together with their selected automated tests. The product continues to evolve; this is a reviewed source snapshot for engineering inspection.

## Start with the engineering

| Engineering problem | Implementation to inspect | What the code demonstrates |
| --- | --- | --- |
| Different consumer DNA formats and malformed input | [Genome parser](src/lib/genome-parser.ts) | Delimited parsing, normalization, explicit format detection, and bounded processing |
| Keeping raw browser state out of narration requests | [Structured findings contract](src/lib/narration/structured-findings-contract.ts) | Typed projection, schema validation, field limits, and separate full-evidence and narrative budgets |
| Matching questions to the correct customer report | [Approved-source resolver](src/server/customer-chat/sources.ts) | Owner-scoped queries, current-report membership, exact identity matching, historical fallback, and explicit errors |
| Keeping evidence distinct from generated explanation | [Evidence provenance](src/lib/performance-suite/evidence-provenance.ts) and [text projection](src/lib/narration/evidence-projection.ts) | Source-derived provenance, no invented citations, and explicit bounded excerpts |
| Separating deterministic decisions from model generation | [Chat routing](src/server/customer-chat/routing.ts) and [answer validation](src/server/customer-chat/validation.ts) | Subject classification, bounded source access, and output normalization |
| Maintaining a browser-side reference-data pipeline | [Enrichment engine](src/lib/enrichment-engine.ts), [adapters](src/lib/data-sources/), and [reference bundle](src/lib/reference-bundle.ts) | Common source contracts, classification inputs, caching, and signed reference verification |

## A five-minute review

1. Open the [source resolver](src/server/customer-chat/sources.ts) alongside its [regression tests](src/server/customer-chat/__tests__/sources.test.ts). Follow how an explicit report reference is scoped to its owner and how current evidence takes precedence over historical matches.
2. Read the [narration construction boundary](src/lib/narration/structured-findings-contract.ts) and its [tests](src/lib/narration/__tests__/structured-findings-contract.test.ts). The test inputs distinguish allowed finding fields from raw browser state and exercise a large example finding set.
3. Follow a malformed input through the [parser tests](src/lib/__tests__/genome-parser-adversarial.test.ts). Confidence and parsing results are exposed explicitly instead of treating every input as a complete valid genome.
4. Run the checks below. Then use the [architecture walkthrough](docs/ARCHITECTURE.md) to connect these components to the product.

## Run the checks

Use Node.js 22.12 or later and npm. In a terminal:

```sh
git clone https://github.com/adolphwhite7/dna-health-insights-engineering.git
cd dna-health-insights-engineering
npm ci --ignore-scripts
npm test
npm run typecheck
```

Dependency installation requires network access. After installation, the selected tests use example inputs and a mocked database interface; they require no accounts, credentials, database, model provider, or customer files. The test setup rejects unexpected `fetch` calls. Type checking covers the implementation; Vitest executes the test files.

The tests exercise malformed input, typed data transfer, evidence projection, provenance, question routing, report ownership and identity resolution, and answer normalization. See the [source and test guide](docs/SOURCE_GUIDE.md) for the exact boundaries. These checks establish component behavior; they do not constitute clinical validation or a fresh end-to-end production test.

## My contribution

I am Adolph White Jr., Chief Architect of DNA Health Insights. My work covers system architecture, technical requirements, implementation direction, engineering review, and production acceptance, using AI-assisted development tools. This repository makes the resulting implementation and its engineering decisions inspectable. The live product provides the wider product context.

## Public source scope

The source snapshot is drawn from the product repository at commit `88d9ab2cc6c4a4de5bd1c3feab6af45accbc3837` (October 9, 2026). The selected implementation and tests retain their product behavior. The public export removes an unused competitor-comparison table, replaces a few obsolete or internal comments, and neutralizes fixture names and timestamps; the small package and test setup make the selection independently reviewable.

Customer files, raw genome datasets, account/report exports, credentials, deployment configuration, and internal operating records are excluded. Included fixtures are examples for testing. The reference verification key is a public key; no signing key is included.

This is a source-inspection and test package. The hosted interface, production database, reference-data releases, model execution, payments, and deployment system remain part of the separately operated product. [Source boundaries](docs/SOURCE_GUIDE.md#what-is-included) explain which supporting modules are included for readability and type completeness and which behaviors the runnable checks cover.

DNA Health Insights is an educational product. The source examples and tests are engineering material, not individualized medical advice.
