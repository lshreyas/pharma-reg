"""Turn raw source JSON into chunks the extractor can consume.

Both Milestone-1 sources are JSON. Each source knows how to walk itself
and yield a sequence of (section_path, text) pairs; a shared chunker then
assigns stable IDs and splits anything above `MAX_CHARS`.

`section` acts as the pseudo-page reference — carried through provenance
so the report can point at "adverse_reactions" or
"protocolSection.designModule" instead of a page number.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from .config import PARSED, RAW, ensure_data_dirs
from .fetch import load_manifest
from .ontology import Chunk, Document


MAX_CHARS = 8000  # per-chunk soft ceiling


# Sections worth extracting from. Anything else is skipped to keep the
# extractor focused on facts the ontology covers.
# Kept as ordered tuples so chunk ordinals are stable across runs.
CTGOV_PROTOCOL_MODULES = (
    "identificationModule",
    "sponsorCollaboratorsModule",
    "descriptionModule",
    "conditionsModule",
    "designModule",
    "armsInterventionsModule",
    "outcomesModule",
    "eligibilityModule",
)
CTGOV_RESULTS_MODULES = (
    "participantFlowModule",
    "baselineCharacteristicsModule",
    "outcomeMeasuresModule",
    "adverseEventsModule",
)

OPENFDA_SECTIONS = (
    "indications_and_usage",
    "dosage_and_administration",
    "dosage_forms_and_strengths",
    "contraindications",
    "warnings_and_cautions",
    "adverse_reactions",
    "clinical_studies",
    "how_supplied",
    "storage_and_handling",
    "description",
    "clinical_pharmacology",
    "mechanism_of_action",
    "pharmacokinetics",
)


def _walk_ctgov(raw: dict) -> Iterator[tuple[str, str]]:
    proto = raw.get("protocolSection", {}) or {}
    for name in CTGOV_PROTOCOL_MODULES:
        mod = proto.get(name)
        if mod:
            yield f"protocolSection.{name}", json.dumps(mod, indent=2)

    results = raw.get("resultsSection", {}) or {}
    for name in CTGOV_RESULTS_MODULES:
        mod = results.get(name)
        if mod:
            yield f"resultsSection.{name}", json.dumps(mod, indent=2)


def _walk_openfda(raw: dict) -> Iterator[tuple[str, str]]:
    for section in OPENFDA_SECTIONS:
        val = raw.get(section)
        if not val:
            continue
        # openFDA sections come back as lists of paragraph strings.
        if isinstance(val, list):
            text = "\n\n".join(v for v in val if isinstance(v, str) and v.strip())
        elif isinstance(val, str):
            text = val
        else:
            text = json.dumps(val, indent=2)
        if text.strip():
            yield section, text


def _split(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts: list[str] = []
    remaining = text
    while len(remaining) > limit:
        # Prefer to split on a paragraph, then a line, then a hard cut.
        cut = remaining.rfind("\n\n", 0, limit)
        if cut < limit // 2:
            cut = remaining.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = limit
        parts.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    if remaining:
        parts.append(remaining)
    return parts


def parse_document(doc: Document) -> list[Chunk]:
    raw_path = RAW / doc.program_id / f"{doc.id}.json"
    raw = json.loads(raw_path.read_text())

    if doc.doc_type == "clinicaltrials":
        walker = _walk_ctgov(raw)
    elif doc.doc_type == "fda_label":
        walker = _walk_openfda(raw)
    else:
        raise ValueError(f"No parser for doc_type={doc.doc_type}")

    chunks: list[Chunk] = []
    ordinal = 0
    for section, text in walker:
        for piece in _split(text, MAX_CHARS):
            chunk_id = f"{doc.id}#{ordinal:03d}"
            chunks.append(
                Chunk(
                    id=chunk_id,
                    doc_id=doc.id,
                    ordinal=ordinal,
                    section=section,
                    text=piece,
                )
            )
            ordinal += 1
    return chunks


def parse_program(program_id: str) -> dict[str, list[Chunk]]:
    ensure_data_dirs()
    docs = load_manifest(program_id)
    out_dir = PARSED / program_id
    out_dir.mkdir(parents=True, exist_ok=True)

    result: dict[str, list[Chunk]] = {}
    for doc in docs:
        chunks = parse_document(doc)
        out_path = out_dir / f"{doc.id}.jsonl"
        with out_path.open("w") as f:
            for c in chunks:
                f.write(c.model_dump_json() + "\n")
        result[doc.id] = chunks
        print(f"  parsed {doc.id}  →  {len(chunks)} chunks")
    return result


def load_chunks(program_id: str, doc_id: str) -> list[Chunk]:
    path = PARSED / program_id / f"{doc_id}.jsonl"
    return [Chunk.model_validate_json(line) for line in path.read_text().splitlines() if line]
