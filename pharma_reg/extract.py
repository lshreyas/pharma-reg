"""Structured extraction of facts from parsed chunks via the Claude API.

Design notes:
  - JSON-schema-constrained output (`messages.parse`) so the model can only
    return well-formed `ExtractionResponse` objects — no free-form parsing.
  - Adaptive thinking on Opus 4.7: the model decides how much to reason per
    chunk. The ontology description is stable across every call, so we anchor
    prompt caching on the system prompt.
  - Extraction is incremental: results append to a JSONL file per document so
    a partial run is resumable and inspectable.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic

from .config import EXTRACTED, ensure_data_dirs, model_id
from .fetch import ProgramManifest, load_manifest
from .ontology import Chunk, EntityType, ExtractionResponse, Fact, PROPERTIES
from .parse import load_chunks


def _ontology_description() -> str:
    lines = ["Entity types and their expected properties:"]
    for et in EntityType:
        props = ", ".join(PROPERTIES[et])
        lines.append(f"  - {et.value}: {props}")
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You are a pharmaceutical regulatory analyst extracting structured facts from
regulatory documents (FDA labels, ClinicalTrials.gov records, EMA assessment
reports, and similar). Your job is *extraction*, not summarization.

{_ontology_description()}

Extraction rules:
  1. Extract only facts *directly stated* in the source text. Do NOT infer,
     paraphrase, or combine claims. If a number is stated, extract it as
     written; do not do arithmetic on it.
  2. Every fact must include a verbatim `quote` from the source text — a
     short span (≤ 250 chars) that supports the claim. If you cannot cite a
     quote, do not extract the fact.
  3. Prefer the property names listed above for the entity type. If the
     source states a property not in the list, use a lowercase_snake_case
     name that reflects the source's wording.
  4. `entity_id` for a Trial is the trial identifier as written in the
     source (e.g. "KEYNOTE-189", "NCT02578680", "MK-3475-189"). For a Drug,
     use the INN (e.g. "pembrolizumab") when present, else the brand name.
     Entity resolution is handled downstream — do not attempt to normalize.
  5. `confidence` is your calibrated judgement (0.0–1.0) that the fact is
     correctly extracted from the text. Reserve values ≥0.95 for facts that
     are unambiguous and directly quoted.
  6. If a chunk has no facts within the ontology, return an empty `facts`
     array. Do not fabricate."""


def _user_message(program: ProgramManifest, doc_title: str, chunk: Chunk) -> str:
    return f"""Program context:
  drug: {program.drug_name}  (brand: {program.brand_name or 'n/a'})
  indication of interest: {program.indication}

Source document: {doc_title}
Section (pseudo-page): {chunk.section}
Chunk id: {chunk.id}

--- CHUNK TEXT ---
{chunk.text}
--- END CHUNK ---

Extract every fact from this chunk that fits the ontology. Return only
facts you can cite verbatim."""


def extract_chunk(
    client: anthropic.Anthropic,
    program: ProgramManifest,
    doc_title: str,
    chunk: Chunk,
) -> list[Fact]:
    # Streaming so we don't hit the SDK's non-streaming timeout guard at high
    # max_tokens; 24k gives comfortable headroom for thinking + JSON on rich
    # chunks. See the shared claude-api guidance on max_tokens ceilings.
    try:
        with client.messages.stream(
            model=model_id(),
            max_tokens=24000,
            thinking={"type": "adaptive"},
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {"role": "user", "content": _user_message(program, doc_title, chunk)}
            ],
            output_config={"format": {"type": "json_schema",
                                       "schema": ExtractionResponse.model_json_schema()}},
        ) as stream:
            final = stream.get_final_message()
    except anthropic.APIError as e:
        print(f"    ! API error on {chunk.id}: {e}; skipping chunk")
        return []

    # With output_config.format=json_schema the first (and only) text block is
    # valid JSON. Truncation still shows up as `stop_reason == "max_tokens"`;
    # treat that as a data-quality miss and skip rather than crashing the run.
    if final.stop_reason == "max_tokens":
        print(f"    ! {chunk.id}: hit max_tokens; skipping chunk")
        return []

    text = next((b.text for b in final.content if b.type == "text"), None)
    if not text:
        return []
    try:
        parsed = ExtractionResponse.model_validate_json(text)
    except Exception as e:  # noqa: BLE001 — surface any parse failure and continue
        print(f"    ! {chunk.id}: JSON validation failed ({e.__class__.__name__}); skipping chunk")
        return []

    for f in parsed.facts:
        f.doc_id = chunk.doc_id
        f.chunk_id = chunk.id
        f.page = chunk.section
    return parsed.facts


def extract_program(program_id: str, max_chunks: int | None = None) -> dict[str, int]:
    """Extract facts for every doc in a program. Returns per-doc fact counts."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set. Copy .env.example to .env and fill it in, "
            "or export the variable directly."
        )

    ensure_data_dirs()
    program = ProgramManifest.load(program_id)
    docs = load_manifest(program_id)
    out_dir = EXTRACTED / program_id
    out_dir.mkdir(parents=True, exist_ok=True)

    client = anthropic.Anthropic()
    counts: dict[str, int] = {}

    for doc in docs:
        chunks = load_chunks(program_id, doc.id)
        if max_chunks is not None:
            chunks = chunks[:max_chunks]
        out_path = out_dir / f"{doc.id}.jsonl"
        n_facts = 0
        with out_path.open("w") as f:
            for i, chunk in enumerate(chunks, start=1):
                facts = extract_chunk(client, program, doc.title, chunk)
                for fact in facts:
                    f.write(fact.model_dump_json() + "\n")
                n_facts += len(facts)
                print(
                    f"  [{doc.id}] chunk {i}/{len(chunks)}  "
                    f"section={chunk.section}  facts={len(facts)}"
                )
        counts[doc.id] = n_facts
        print(f"  → {doc.id}: {n_facts} facts")

    return counts


def load_facts(program_id: str) -> list[Fact]:
    """Load every extracted fact for a program across all docs."""
    facts: list[Fact] = []
    prog_dir = EXTRACTED / program_id
    if not prog_dir.exists():
        return facts
    for path in sorted(prog_dir.glob("*.jsonl")):
        for line in path.read_text().splitlines():
            if line.strip():
                facts.append(Fact.model_validate_json(line))
    return facts
