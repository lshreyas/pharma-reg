"""Consistency engine.

Two checks for Milestone 1:

1. Numeric mismatch — when two documents state a numeric value for the same
   (entity, property) and the values differ.

2. Cross-document coverage — when a property is stated in some documents but
   not others for the same entity, surface the omission as a candidate.

Both check types produce a `Flag` with enough provenance to render a
human-reviewable line item in the report.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

from .kg import all_facts, documents


FlagType = Literal["numeric_mismatch", "missing_fact"]


@dataclass
class Evidence:
    doc_id: str
    doc_title: str
    page: str | None
    value: str
    value_num: float | None
    unit: str | None
    quote: str
    confidence: float
    chunk_id: str | None


@dataclass
class Flag:
    type: FlagType
    entity_type: str
    entity_id: str
    property: str
    summary: str
    evidence: list[Evidence] = field(default_factory=list)
    # For missing_fact only: docs that *don't* mention the property.
    missing_from: list[tuple[str, str]] = field(default_factory=list)  # (doc_id, doc_title)


# ---------- Numeric tolerances -----------------------------------------------

# When both values parse numerically, we compare with a unit-aware tolerance.
# Anything outside tolerance is a candidate mismatch.
_TOLERANCE_ABS = {
    "%": 1.0,          # percent points
    "months": 0.5,     # months
    "years": 0.1,
    "mg": 0.0,         # dose — any delta is worth surfacing
    "mg/kg": 0.0,
    "patients": 0.0,   # enrollment — any delta
}
_DEFAULT_ABS = 0.0


def _numeric_diff_exceeds_tolerance(
    a: float, b: float, unit: str | None
) -> bool:
    tol = _TOLERANCE_ABS.get((unit or "").lower(), _DEFAULT_ABS)
    return abs(a - b) > tol


def _property_key(prop: str) -> str:
    """Normalize property strings the extractor might have varied slightly on.

    Deliberately conservative — we only fold in obvious equivalents. The rest
    are left as-is; that lets the report surface "possible synonyms" as a
    future check.
    """
    p = prop.strip().lower()
    synonyms = {
        "sample_size": "enrollment",
        "n": "enrollment",
        "num_enrolled": "enrollment",
        "n_enrolled": "enrollment",
    }
    return synonyms.get(p, p)


def _row_to_evidence(row: sqlite3.Row, doc_titles: dict[str, str]) -> Evidence:
    return Evidence(
        doc_id=row["doc_id"],
        doc_title=doc_titles.get(row["doc_id"], row["doc_id"]),
        page=row["page"],
        value=row["value"],
        value_num=row["value_num"],
        unit=row["unit"],
        quote=row["quote"],
        confidence=row["confidence"],
        chunk_id=row["chunk_id"],
    )


def check_numeric_mismatch(program_id: str) -> list[Flag]:
    doc_rows = documents(program_id)
    doc_titles = {r["id"]: r["title"] for r in doc_rows}

    # Group facts by (entity_type, entity_id, canonical_property).
    groups: dict[tuple[str, str, str], list[sqlite3.Row]] = defaultdict(list)
    for row in all_facts(program_id):
        key = (row["entity_type"], row["entity_id"], _property_key(row["property"]))
        groups[key].append(row)

    flags: list[Flag] = []
    for (etype, eid, prop), rows in groups.items():
        # Only consider rows with a numeric value.
        numeric_rows = [r for r in rows if r["value_num"] is not None]
        if len(numeric_rows) < 2:
            continue

        # Group by document — a single doc restating a value doesn't count
        # as a cross-source mismatch.
        by_doc: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for r in numeric_rows:
            by_doc[r["doc_id"]].append(r)
        if len(by_doc) < 2:
            continue

        # Pick one representative row per doc (highest confidence).
        reps: list[sqlite3.Row] = [
            max(rs, key=lambda r: r["confidence"]) for rs in by_doc.values()
        ]

        # Are any two reps outside tolerance?
        mismatch = False
        for i in range(len(reps)):
            for j in range(i + 1, len(reps)):
                a, b = reps[i]["value_num"], reps[j]["value_num"]
                unit = reps[i]["unit"] or reps[j]["unit"]
                if _numeric_diff_exceeds_tolerance(a, b, unit):
                    mismatch = True
                    break
            if mismatch:
                break
        if not mismatch:
            continue

        evidence = [_row_to_evidence(r, doc_titles) for r in reps]
        values_str = ", ".join(f"{r['value']!r} ({doc_titles.get(r['doc_id'], r['doc_id'])})" for r in reps)
        flags.append(
            Flag(
                type="numeric_mismatch",
                entity_type=etype,
                entity_id=eid,
                property=prop,
                summary=f"Numeric values differ across sources: {values_str}",
                evidence=evidence,
            )
        )
    return flags


def check_missing_facts(program_id: str, min_sources_seen: int = 2) -> list[Flag]:
    """A (entity, property) pair stated in ≥`min_sources_seen` documents but
    absent from at least one other is flagged as a candidate omission.
    """
    doc_rows = documents(program_id)
    doc_titles = {r["id"]: r["title"] for r in doc_rows}
    all_doc_ids = set(doc_titles)

    # Which docs cover each (entity, property).
    coverage: dict[tuple[str, str, str], dict[str, list[sqlite3.Row]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for row in all_facts(program_id):
        key = (row["entity_type"], row["entity_id"], _property_key(row["property"]))
        coverage[key][row["doc_id"]].append(row)

    flags: list[Flag] = []
    for (etype, eid, prop), by_doc in coverage.items():
        covering_docs = set(by_doc)
        if len(covering_docs) < min_sources_seen:
            continue
        missing_docs = all_doc_ids - covering_docs
        if not missing_docs:
            continue

        # Take a representative fact from each covering doc as evidence.
        evidence: list[Evidence] = []
        for doc_id, rs in by_doc.items():
            rep = max(rs, key=lambda r: r["confidence"])
            evidence.append(_row_to_evidence(rep, doc_titles))

        flags.append(
            Flag(
                type="missing_fact",
                entity_type=etype,
                entity_id=eid,
                property=prop,
                summary=(
                    f"Present in {len(covering_docs)} document(s), "
                    f"absent from {len(missing_docs)}."
                ),
                evidence=evidence,
                missing_from=[(d, doc_titles[d]) for d in sorted(missing_docs)],
            )
        )
    return flags


def run_all(program_id: str) -> list[Flag]:
    return check_numeric_mismatch(program_id) + check_missing_facts(program_id)
