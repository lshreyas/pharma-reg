"""Render consistency flags as a Markdown report.

Every flag block links back to its evidence (source doc, pseudo-page,
extraction confidence, verbatim quote) so a reviewer can adjudicate without
leaving the report.
"""

from __future__ import annotations

from pathlib import Path

from .config import REPORTS
from .consistency import Flag, run_all
from .kg import documents


def _fmt_evidence_lines(evidence, indent: str = "  ") -> list[str]:
    lines: list[str] = []
    for ev in evidence:
        conf = f"{ev.confidence:.2f}"
        page = ev.page or "?"
        unit = f" {ev.unit}" if ev.unit else ""
        lines.append(
            f"{indent}- **{ev.doc_title}** · `{page}` · value=`{ev.value}`{unit} · confidence={conf}"
        )
        # Quote — collapse whitespace and truncate.
        q = " ".join(ev.quote.split())
        if len(q) > 260:
            q = q[:257] + "…"
        lines.append(f"{indent}  > {q}")
    return lines


def render(program_id: str, flags: list[Flag]) -> str:
    doc_rows = documents(program_id)

    out: list[str] = []
    out.append(f"# Consistency report — `{program_id}`\n")
    out.append(f"**Sources analyzed:** {len(doc_rows)}\n")
    for d in doc_rows:
        version = f" · v.{d['version']}" if d["version"] else ""
        out.append(
            f"- `{d['id']}` — {d['title']} · {d['jurisdiction']}{version}"
        )
    out.append("")

    numeric = [f for f in flags if f.type == "numeric_mismatch"]
    missing = [f for f in flags if f.type == "missing_fact"]
    out.append(f"**Flags:** {len(flags)} total — "
               f"{len(numeric)} numeric mismatch, {len(missing)} missing-fact\n")

    if not flags:
        out.append("_No inconsistencies found._")
        return "\n".join(out)

    if numeric:
        out.append("## Numeric mismatches\n")
        for i, flag in enumerate(numeric, start=1):
            out.append(
                f"### {i}. `{flag.entity_type}` / `{flag.entity_id}` · `{flag.property}`"
            )
            out.append("")
            out.append(flag.summary)
            out.append("")
            out.extend(_fmt_evidence_lines(flag.evidence))
            out.append("")

    if missing:
        out.append("## Missing-fact candidates\n")
        out.append(
            "_A property stated in some sources but absent from others. Not "
            "necessarily a defect — regional labels legitimately omit content. "
            "Included for reviewer triage._\n"
        )
        for i, flag in enumerate(missing, start=1):
            out.append(
                f"### {i}. `{flag.entity_type}` / `{flag.entity_id}` · `{flag.property}`"
            )
            out.append("")
            out.append(flag.summary)
            out.append("")
            out.append("**Stated in:**")
            out.extend(_fmt_evidence_lines(flag.evidence))
            if flag.missing_from:
                out.append("")
                out.append("**Absent from:**")
                for doc_id, title in flag.missing_from:
                    out.append(f"  - `{doc_id}` — {title}")
            out.append("")

    return "\n".join(out)


def build_report(program_id: str) -> Path:
    flags = run_all(program_id)
    text = render(program_id, flags)
    out_path = REPORTS / f"{program_id}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text)
    return out_path
