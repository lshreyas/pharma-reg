from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
PARSED = DATA / "parsed"
EXTRACTED = DATA / "extracted"
DB_DIR = DATA / "db"
REPORTS = DATA / "reports"
PROGRAMS = ROOT / "programs"


def ensure_data_dirs() -> None:
    for d in (RAW, PARSED, EXTRACTED, DB_DIR, REPORTS):
        d.mkdir(parents=True, exist_ok=True)


def db_path(program_id: str) -> Path:
    return DB_DIR / f"{program_id}.sqlite"


def model_id() -> str:
    return os.environ.get("PHARMA_REG_MODEL", "claude-opus-4-7")
