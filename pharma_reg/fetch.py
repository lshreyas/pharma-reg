"""Fetch source documents for a program.

Two sources for Milestone 1, both returning JSON:
- ClinicalTrials.gov v2:  /api/v2/studies/{NCT_ID}
- openFDA drug labels:    /drug/label.json?search=openfda.brand_name:"KEYTRUDA"

Raw JSON is saved to data/raw/{program_id}/{doc_id}.json, plus a manifest.json
that captures Document metadata (id, source_url, fetched_at, ...).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml

from .config import PROGRAMS, RAW, ensure_data_dirs
from .ontology import Document


CT_GOV = "https://clinicaltrials.gov/api/v2/studies"
OPENFDA_LABEL = "https://api.fda.gov/drug/label.json"


@dataclass
class ProgramManifest:
    id: str
    name: str
    drug_name: str
    brand_name: str | None
    indication: str
    aliases: dict
    sources: list[dict]

    @classmethod
    def load(cls, program_id: str) -> "ProgramManifest":
        path = PROGRAMS / f"{program_id}.yaml"
        with path.open() as f:
            data = yaml.safe_load(f)
        return cls(
            id=data["id"],
            name=data["name"],
            drug_name=data["drug_name"],
            brand_name=data.get("brand_name"),
            indication=data["indication"],
            aliases=data.get("aliases", {}),
            sources=data["sources"],
        )


def _iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def _get_with_retry(url: str, params: dict | None = None, tries: int = 3) -> httpx.Response:
    delay = 1.0
    last: Exception | None = None
    for _ in range(tries):
        try:
            r = httpx.get(url, params=params, timeout=30.0, follow_redirects=True)
            r.raise_for_status()
            return r
        except (httpx.HTTPError,) as e:
            last = e
            time.sleep(delay)
            delay *= 2
    assert last is not None
    raise last


def _fetch_clinicaltrials(nct_id: str) -> tuple[dict, str]:
    """Return (raw_json, source_url)."""
    url = f"{CT_GOV}/{nct_id}"
    r = _get_with_retry(url)
    return r.json(), url


def _fetch_openfda_label(brand_name: str) -> tuple[dict, str]:
    """Return (raw_json_single_result, source_url). Picks the newest label."""
    params = {
        "search": f'openfda.brand_name:"{brand_name}"',
        "limit": 1,
    }
    r = _get_with_retry(OPENFDA_LABEL, params=params)
    payload = r.json()
    results = payload.get("results", [])
    if not results:
        raise RuntimeError(f"openFDA returned no label for brand '{brand_name}'")
    return results[0], str(r.request.url)


def fetch_program(program_id: str) -> list[Document]:
    """Fetch all sources for a program. Returns Document metadata list."""
    ensure_data_dirs()
    manifest = ProgramManifest.load(program_id)
    out_dir = RAW / program_id
    out_dir.mkdir(parents=True, exist_ok=True)

    docs: list[Document] = []
    for src in manifest.sources:
        kind = src["kind"]
        src_id = src["id"]
        doc_id = f"{kind}__{src_id}"
        out_path = out_dir / f"{doc_id}.json"

        if kind == "clinicaltrials":
            raw, url = _fetch_clinicaltrials(src_id)
            version = _ctgov_version(raw)
        elif kind == "openfda_label":
            raw, url = _fetch_openfda_label(src_id)
            version = _openfda_version(raw)
        else:
            raise ValueError(f"Unknown source kind: {kind}")

        out_path.write_text(json.dumps(raw, indent=2))

        doc = Document(
            id=doc_id,
            program_id=program_id,
            doc_type=src["doc_type"],
            jurisdiction=src["jurisdiction"],
            title=src.get("title", doc_id),
            source_url=url,
            fetched_at=_iso_now(),
            version=version,
        )
        docs.append(doc)
        print(f"  fetched {doc_id}  →  {out_path.relative_to(out_dir.parent.parent)}")

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps([d.model_dump() for d in docs], indent=2)
    )
    return docs


def _ctgov_version(raw: dict) -> str | None:
    ps = raw.get("protocolSection", {})
    status = ps.get("statusModule", {})
    return status.get("lastUpdatePostDateStruct", {}).get("date")


def _openfda_version(raw: dict) -> str | None:
    # openFDA labels expose 'effective_time' as YYYYMMDD.
    return raw.get("effective_time")


def load_manifest(program_id: str) -> list[Document]:
    """Load cached Document metadata written by `fetch_program`."""
    path = RAW / program_id / "manifest.json"
    data = json.loads(path.read_text())
    return [Document.model_validate(d) for d in data]
