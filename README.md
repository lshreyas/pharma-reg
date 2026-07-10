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

## Run it

```sh
python3 -m venv .venv && .venv/bin/pip install -e .
export ANTHROPIC_API_KEY=sk-ant-...

# One command, all stages:
pharma-reg run pembrolizumab_lung

# Or stage by stage:
pharma-reg fetch    pembrolizumab_lung        # openFDA + CT.gov → data/raw/
pharma-reg parse    pembrolizumab_lung        # → data/parsed/*.jsonl
pharma-reg extract  pembrolizumab_lung        # → data/extracted/*.jsonl  (Claude API)
pharma-reg build-kg pembrolizumab_lung        # → data/db/*.sqlite
pharma-reg check    pembrolizumab_lung        # → prints flag summary
pharma-reg report   pembrolizumab_lung        # → data/reports/*.md
```

Use `--max-chunks N` on `extract` / `run` to cap chunks per document for a
cheap dry-run (about $0.05/chunk on Claude Opus 4.7).
