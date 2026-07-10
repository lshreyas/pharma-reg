"""Command-line orchestrator.

Sub-commands mirror the pipeline stages so each can run standalone:

    pharma-reg fetch    <program>
    pharma-reg parse    <program>
    pharma-reg extract  <program> [--max-chunks N]
    pharma-reg build-kg <program>
    pharma-reg check    <program>
    pharma-reg report   <program>
    pharma-reg run      <program> [--max-chunks N]  # all of the above
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _cmd_fetch(program: str, **_) -> int:
    from .fetch import fetch_program
    fetch_program(program)
    return 0


def _cmd_parse(program: str, **_) -> int:
    from .parse import parse_program
    parse_program(program)
    return 0


def _cmd_extract(program: str, max_chunks: int | None = None, **_) -> int:
    from .extract import extract_program
    extract_program(program, max_chunks=max_chunks)
    return 0


def _cmd_build_kg(program: str, **_) -> int:
    from .extract import load_facts
    from .fetch import ProgramManifest, load_manifest
    from .kg import load_program
    from .resolve import resolve

    prog = ProgramManifest.load(program)
    docs = load_manifest(program)
    facts = load_facts(program)
    if not facts:
        print(f"no extracted facts for {program}; run `extract` first", file=sys.stderr)
        return 2
    facts = resolve(prog, facts)
    load_program(program, docs, facts)
    print(f"  loaded {len(facts)} facts across {len(docs)} documents")
    return 0


def _cmd_check(program: str, **_) -> int:
    from .consistency import run_all
    flags = run_all(program)
    print(f"  {len(flags)} flag(s)")
    for f in flags:
        print(f"    [{f.type}] {f.entity_type}/{f.entity_id}::{f.property}")
    return 0


def _cmd_report(program: str, **_) -> int:
    from .report import build_report
    path = build_report(program)
    print(f"  report written: {path}")
    return 0


def _cmd_run(program: str, max_chunks: int | None = None, **_) -> int:
    print(">> fetch");    _cmd_fetch(program)
    print(">> parse");    _cmd_parse(program)
    print(">> extract");  _cmd_extract(program, max_chunks=max_chunks)
    print(">> build-kg"); _cmd_build_kg(program)
    print(">> check");    _cmd_check(program)
    print(">> report");   _cmd_report(program)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="pharma-reg")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name: str, fn, extract_like: bool = False):
        sp = sub.add_parser(name)
        sp.add_argument("program", help="program id (e.g. pembrolizumab_lung)")
        if extract_like:
            sp.add_argument(
                "--max-chunks",
                type=int,
                default=None,
                help="cap chunks per doc for a cheap test run",
            )
        sp.set_defaults(func=fn)

    add("fetch", _cmd_fetch)
    add("parse", _cmd_parse)
    add("extract", _cmd_extract, extract_like=True)
    add("build-kg", _cmd_build_kg)
    add("check", _cmd_check)
    add("report", _cmd_report)
    add("run", _cmd_run, extract_like=True)

    args = p.parse_args(argv)
    kwargs = {k: v for k, v in vars(args).items() if k not in {"cmd", "func"}}
    return args.func(**kwargs)


if __name__ == "__main__":
    raise SystemExit(main())
