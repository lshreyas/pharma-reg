"""SQLite triple store with provenance.

Two tables:
  - documents: one row per source document
  - facts:     one row per extracted (entity, property, value) claim, keyed
               back to the document via `doc_id` and to the source chunk via
               `chunk_id` + `page` (the pseudo-page / section path).

The KG is per-program; each program gets its own .sqlite so runs stay
isolated. Idempotent: `load_program` recreates the DB from scratch.
"""

from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .config import db_path
from .fetch import load_manifest
from .ontology import Document, Fact


SCHEMA = """
CREATE TABLE documents (
    id           TEXT PRIMARY KEY,
    program_id   TEXT NOT NULL,
    doc_type     TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    title        TEXT NOT NULL,
    source_url   TEXT NOT NULL,
    fetched_at   TEXT NOT NULL,
    version      TEXT
);

CREATE TABLE facts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id    TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    entity_id_raw TEXT,
    property      TEXT NOT NULL,
    value         TEXT NOT NULL,
    value_num     REAL,
    unit          TEXT,
    doc_id        TEXT NOT NULL REFERENCES documents(id),
    chunk_id      TEXT,
    page          TEXT,
    quote         TEXT NOT NULL,
    confidence    REAL NOT NULL
);

CREATE INDEX idx_facts_lookup ON facts(program_id, entity_type, entity_id, property);
CREATE INDEX idx_facts_by_doc ON facts(doc_id);
"""


_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _try_numeric(value: str) -> float | None:
    """Best-effort numeric extraction from the value string.

    We match the *first* signed decimal number in the string. This handles
    "616 patients", "72%", "5.4 months", "0.49", "HR 0.62 (95% CI 0.47-0.83)"
    (grabs 0.62 — the point estimate) reasonably well. Anything more nuanced
    is left to the consistency engine.
    """
    m = _NUM_RE.search(value)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


@contextmanager
def connect(program_id: str) -> Iterator[sqlite3.Connection]:
    path = db_path(program_id)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(program_id: str) -> None:
    path = db_path(program_id)
    if path.exists():
        path.unlink()
    with connect(program_id) as conn:
        conn.executescript(SCHEMA)


def load_program(program_id: str, docs: list[Document], facts: list[Fact]) -> None:
    init_db(program_id)
    with connect(program_id) as conn:
        conn.executemany(
            """
            INSERT INTO documents (id, program_id, doc_type, jurisdiction,
                                   title, source_url, fetched_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    d.id,
                    d.program_id,
                    d.doc_type,
                    d.jurisdiction,
                    d.title,
                    d.source_url,
                    d.fetched_at,
                    d.version,
                )
                for d in docs
            ],
        )
        conn.executemany(
            """
            INSERT INTO facts (
                program_id, entity_type, entity_id, entity_id_raw,
                property, value, value_num, unit,
                doc_id, chunk_id, page, quote, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    program_id,
                    f.entity_type.value,
                    f.entity_id,
                    f.entity_id_raw,
                    f.property,
                    f.value,
                    _try_numeric(f.value),
                    f.unit,
                    f.doc_id,
                    f.chunk_id,
                    f.page,
                    f.quote,
                    f.confidence,
                )
                for f in facts
            ],
        )


def all_facts(program_id: str) -> list[sqlite3.Row]:
    with connect(program_id) as conn:
        rows = conn.execute(
            "SELECT * FROM facts WHERE program_id = ? ORDER BY entity_type, entity_id, property",
            (program_id,),
        ).fetchall()
    return list(rows)


def documents(program_id: str) -> list[sqlite3.Row]:
    with connect(program_id) as conn:
        return list(conn.execute(
            "SELECT * FROM documents WHERE program_id = ?", (program_id,)
        ).fetchall())
