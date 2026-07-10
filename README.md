# pharma-reg

Regulatory filing consistency analysis — pipeline plans, working mocks, and (soon) the extraction / knowledge-graph / consistency-checking pipeline itself.

## What's here

- [`regulatory_filing_consistency_analysis_plan.md`](regulatory_filing_consistency_analysis_plan.md) — the plan for the end-to-end pipeline.
- [`mocks/`](mocks/) — interactive HTML + JSX mockups exploring what grounded, HITL regulatory authoring could look like.
- [`index.html`](index.html) — landing page for the hosted mocks (see below).

## Hosted mocks

Live on GitHub Pages: <https://lshreyas.github.io/pharma-reg/>

| Mock | Live | Source |
| --- | --- | --- |
| Regulatory document map | [view](https://lshreyas.github.io/pharma-reg/mocks/regulatory-document-map.html) | [`mocks/regulatory-document-map.html`](mocks/regulatory-document-map.html) |
| Content building blocks — reuse map | [view](https://lshreyas.github.io/pharma-reg/mocks/component-reuse-matrix.html) | [`mocks/component-reuse-matrix.html`](mocks/component-reuse-matrix.html) |
| Who touches what — org × documents | [view](https://lshreyas.github.io/pharma-reg/mocks/org-interaction-matrix.html) | [`mocks/org-interaction-matrix.html`](mocks/org-interaction-matrix.html) |
| CSR authoring — HITL (React source) | — | [`mocks/csr-authoring-hitl.jsx`](mocks/csr-authoring-hitl.jsx) |
| Patient safety narrative — grounded generation (React source) | — | [`mocks/narrative-gen-mockup.jsx`](mocks/narrative-gen-mockup.jsx) |

The `.html` mocks render as-is in the browser. The `.jsx` files are React source; they live in the repo for reference but aren't published to Pages.

## What's coming

An end-to-end pipeline for **one drug program** (pembrolizumab / KEYNOTE-189):

```
fetch (openFDA + ClinicalTrials.gov)
   ↓
parse + chunk
   ↓
Claude structured extraction   →   facts (entity/property/value/units/source/page/quote/confidence)
   ↓
entity resolution              →   canonical drugs, trials, endpoints
   ↓
SQLite triple store            →   knowledge graph with provenance
   ↓
consistency engine             →   numeric mismatch + missing-fact checks
   ↓
markdown report                →   flagged discrepancies with evidence snippets
```

See the plan doc for the full ontology and phases.
