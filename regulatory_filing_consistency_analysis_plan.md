# Regulatory Filing Consistency Analysis Plan

## Objective

Build a reproducible pipeline that identifies factual inconsistencies,
omissions, and semantic drift across pharmaceutical regulatory documents
for the same drug development program.

The end goal is **not** simply to summarize documents, but to construct
a structured regulatory knowledge base that can be queried for
contradictions.

------------------------------------------------------------------------

# Research Questions

1.  How often do regulatory documents contain inconsistent factual
    claims?
2.  Which categories of facts are most susceptible to inconsistency?
3.  Are discrepancies concentrated within a jurisdiction (FDA) or across
    regulators (FDA vs EMA vs PMDA)?
4.  Which inconsistencies are likely to represent genuine quality issues
    versus intentional regulatory differences?

------------------------------------------------------------------------

# High-Level Pipeline

    Document Collection
            ↓
    OCR / Parsing
            ↓
    Chunking
            ↓
    Structured Information Extraction
            ↓
    Entity Resolution
            ↓
    Knowledge Graph
            ↓
    Consistency Checking Engine
            ↓
    Human Review
            ↓
    Evaluation + Dataset

------------------------------------------------------------------------

# Phase 1 --- Define the Ontology

Before extracting anything, define exactly which facts exist in the
system.

## Drug

-   Name
-   Sponsor
-   Mechanism
-   Modality
-   Indication

## Trial

-   Trial ID
-   Phase
-   Enrollment
-   Countries
-   Randomization
-   Blinding

## Treatment Arm

-   Dose
-   Schedule
-   Population
-   Sample size

## Endpoints

-   Primary
-   Secondary
-   Statistical analysis plan

## Results

-   ORR
-   PFS
-   OS
-   Hazard ratio
-   Confidence interval
-   p-value

## Safety

-   Grade ≥3 adverse events
-   Serious adverse events
-   Deaths
-   Discontinuations

## Manufacturing / CMC

-   Dosage form
-   Strength
-   Storage
-   Manufacturing site

Each extracted fact should include:

-   Entity
-   Property
-   Value
-   Units
-   Source document
-   Page number
-   Supporting quotation
-   Extraction confidence

------------------------------------------------------------------------

# Phase 2 --- Collect Documents

Start with **10 approved drug programs**, each with multiple document
types.

Target approximately 15--30 documents per program.

Possible sources:

-   FDA approval package
-   FDA medical review
-   FDA statistical review
-   FDA label
-   Advisory committee briefing documents
-   ClinicalTrials.gov
-   Sponsor press releases
-   SEC filings
-   Investor presentations
-   Published manuscripts

Expansion:

-   EMA assessment reports
-   EMA SmPC
-   PMDA review documents
-   Health Canada
-   TGA Australia

------------------------------------------------------------------------

# Phase 3 --- Parsing

For each document:

-   Convert PDF → text
-   Preserve page boundaries
-   Preserve tables where possible
-   Assign stable chunk IDs
-   Store metadata

Metadata:

-   Drug
-   Document type
-   Version
-   Date
-   Jurisdiction
-   Sponsor

------------------------------------------------------------------------

# Phase 4 --- Structured Extraction

Do NOT summarize.

Instead extract structured facts.

Example:

``` json
{
  "entity": "Trial",
  "entity_id": "KEYNOTE-189",
  "property": "Enrollment",
  "value": 616,
  "unit": "patients",
  "page": 183,
  "quote": "...616 patients were randomized...",
  "confidence": 0.98
}
```

Every extracted fact should be independently traceable back to evidence.

------------------------------------------------------------------------

# Phase 5 --- Entity Resolution

Normalize references.

Examples:

-   Pembrolizumab == Keytruda
-   MK-3475 == Pembrolizumab

Merge:

-   trial names
-   sponsors
-   doses
-   indications
-   biomarkers

This creates one canonical representation for each entity.

------------------------------------------------------------------------

# Phase 6 --- Knowledge Graph

Represent facts as triples.

    (KEYNOTE-189)
            |
    Enrollment
            |
    616

Store provenance on every edge.

This graph becomes the single source of truth for downstream reasoning.

------------------------------------------------------------------------

# Phase 7 --- Consistency Engine

Run automated checks.

## Numeric

Example:

Medical review: Enrollment = 487

Label: Enrollment = 492

→ Flag.

------------------------------------------------------------------------

## Timeline

Examples:

-   Final analysis before enrollment complete
-   Follow-up shorter than reported endpoint maturity

------------------------------------------------------------------------

## Statistical

Examples:

-   Hazard ratio incompatible with confidence interval
-   p-value inconsistent with reported significance

------------------------------------------------------------------------

## Terminology

Examples:

Treatment-naive

vs

Previously untreated

vs

First-line

Determine whether these refer to equivalent populations.

------------------------------------------------------------------------

## Cross-document Drift

Compare:

-   Medical review
-   Label
-   Press release
-   Publication

Detect changes in:

-   efficacy
-   safety
-   subgroup definitions

------------------------------------------------------------------------

## Cross-Jurisdiction

Compare:

FDA

EMA

PMDA

Look for differences in:

-   indication wording
-   warnings
-   contraindications
-   efficacy numbers
-   subgroup analyses

------------------------------------------------------------------------

## Missing Facts

Sometimes the most interesting issue is omission.

Example:

FDA discusses liver toxicity.

EMA discusses liver toxicity.

Japanese label discusses liver toxicity.

US label omits discussion.

These become "missing fact" candidates.

------------------------------------------------------------------------

# Phase 8 --- Human Review

Every flagged inconsistency should include:

-   conflicting facts
-   evidence snippets
-   page references
-   explanation generated by the model

Reviewer labels:

-   True inconsistency
-   Legitimate update
-   Different population
-   Extraction error
-   Acceptable regulatory difference

------------------------------------------------------------------------

# Phase 9 --- Evaluation

Measure:

Extraction

-   Precision
-   Recall

Consistency detection

-   Precision
-   Recall

Human review effort

-   Time saved
-   False positives
-   False negatives

------------------------------------------------------------------------

# Suggested Milestones

## Milestone 1

One drug program

Goal:

End-to-end pipeline.

------------------------------------------------------------------------

## Milestone 2

Ten drug programs

Validate ontology.

Refine prompts.

Measure extraction accuracy.

------------------------------------------------------------------------

## Milestone 3

Fifty programs

Large-scale discrepancy analysis.

------------------------------------------------------------------------

## Milestone 4

Cross-regulator comparison

FDA

EMA

PMDA

Health Canada

TGA

------------------------------------------------------------------------

# Deliverables

-   Regulatory document corpus
-   Structured extraction dataset
-   Regulatory knowledge graph
-   Consistency checking engine
-   Gold-standard benchmark of verified discrepancies
-   Analysis report describing discrepancy types and frequencies

------------------------------------------------------------------------

# Stretch Goals

-   Detect inconsistencies introduced across document versions.
-   Cluster recurring sponsor-specific error patterns.
-   Rank discrepancies by potential regulatory or clinical significance.
-   Fine-tune an extraction model on validated regulatory facts.
-   Build an interactive interface that links every flagged discrepancy
    directly to its supporting evidence.
