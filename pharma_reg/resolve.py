"""Entity resolution.

For Milestone 1 this is deliberately small: an alias table from the program
manifest maps any variant seen in the wild to a canonical entity_id, keyed by
entity_type. The raw string the model produced is preserved on the fact
(`entity_id_raw`) so provenance stays honest.
"""

from __future__ import annotations

from .fetch import ProgramManifest
from .ontology import EntityType, Fact


def _build_reverse_index(
    aliases: dict[str, dict[str, list[str]]],
) -> dict[EntityType, dict[str, str]]:
    """Return {EntityType: {alias_lowercased: canonical_id}}.

    aliases YAML shape: {drug: {pembrolizumab: [Keytruda, MK-3475], ...}, trial: {...}}
    """
    kind_to_entity_type = {
        "drug": EntityType.drug,
        "trial": EntityType.trial,
    }
    index: dict[EntityType, dict[str, str]] = {}
    for kind, canon_map in aliases.items():
        et = kind_to_entity_type.get(kind)
        if et is None:
            continue
        inner: dict[str, str] = {}
        for canonical, variants in canon_map.items():
            inner[canonical.strip().lower()] = canonical
            for v in variants or []:
                inner[v.strip().lower()] = canonical
        index[et] = inner
    return index


def resolve(program: ProgramManifest, facts: list[Fact]) -> list[Fact]:
    """Rewrite `entity_id` in-place to the canonical alias when known. Preserves
    the raw string on `entity_id_raw`.
    """
    reverse = _build_reverse_index(program.aliases)
    for fact in facts:
        raw = fact.entity_id
        fact.entity_id_raw = raw
        table = reverse.get(fact.entity_type)
        if not table:
            continue
        canonical = table.get(raw.strip().lower())
        if canonical:
            fact.entity_id = canonical
    return facts
