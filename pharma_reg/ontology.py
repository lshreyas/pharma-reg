"""Phase-1 ontology and the extracted-fact schema.

Every extracted fact lands in a single `Fact` shape so downstream stages
(entity resolution, KG load, consistency checks) don't need to know the entity
type at the row level. The `entity_type` enum keeps the closed vocabulary
explicit for the extractor prompt.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class EntityType(str, Enum):
    drug = "Drug"
    trial = "Trial"
    treatment_arm = "TreatmentArm"
    endpoint = "Endpoint"
    result = "Result"
    safety = "Safety"
    cmc = "CMC"


# Closed vocabulary of properties per entity type. The extractor is instructed
# to prefer these; anything else goes under `property` verbatim but is flagged
# out-of-vocabulary in the consistency stage.
PROPERTIES: dict[EntityType, tuple[str, ...]] = {
    EntityType.drug: ("name", "sponsor", "mechanism", "modality", "indication"),
    EntityType.trial: (
        "trial_id",
        "phase",
        "enrollment",
        "countries",
        "randomization",
        "blinding",
        "population",
    ),
    EntityType.treatment_arm: ("dose", "schedule", "population", "sample_size"),
    EntityType.endpoint: ("kind", "definition", "statistical_analysis_plan"),
    EntityType.result: (
        "orr",
        "pfs_median_months",
        "os_median_months",
        "hazard_ratio",
        "hr_ci_low",
        "hr_ci_high",
        "p_value",
    ),
    EntityType.safety: (
        "grade_ge_3_ae_rate",
        "serious_ae_rate",
        "deaths",
        "discontinuation_rate",
        "ae_term",  # named adverse event, e.g. "hepatotoxicity"
    ),
    EntityType.cmc: ("dosage_form", "strength", "storage", "manufacturing_site"),
}


class Fact(BaseModel):
    """One extracted claim with provenance.

    `entity_id` is the free-form ID given at extraction time (e.g. "KEYNOTE-189"
    or "pembrolizumab"). Entity resolution rewrites this to a canonical ID
    before KG load, preserving the original in `entity_id_raw`.
    """

    entity_type: EntityType
    entity_id: str = Field(min_length=1, max_length=200)
    property: str = Field(min_length=1, max_length=100)
    value: str = Field(
        description="Verbatim value string as extracted (e.g. '616', '72%', 'randomized 1:1')."
    )
    unit: str | None = Field(default=None, description="e.g. 'patients', '%', 'months'.")
    quote: str = Field(
        min_length=1,
        description="Exact supporting quotation from the source chunk.",
    )
    confidence: float = Field(ge=0.0, le=1.0)

    # These are attached by the extractor wrapper, not the model call.
    doc_id: str | None = None
    chunk_id: str | None = None
    page: str | None = None  # pseudo-page for JSON sources (section path)
    entity_id_raw: str | None = None  # set by resolver


class ExtractionResponse(BaseModel):
    """What the model is asked to return per chunk."""

    facts: list[Fact]


class Chunk(BaseModel):
    id: str
    doc_id: str
    ordinal: int
    section: str  # pseudo-page reference for JSON sources
    text: str


class Document(BaseModel):
    id: str
    program_id: str
    doc_type: Literal[
        "fda_label",
        "clinicaltrials",
        "ema_smpc",
        "press_release",
        "publication",
        "medical_review",
        "other",
    ]
    jurisdiction: Literal["US", "EU", "JP", "CA", "AU", "global", "unknown"]
    title: str
    source_url: str
    fetched_at: str  # ISO 8601
    version: str | None = None  # label version if available
