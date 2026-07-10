import React, { useState, useMemo } from "react";

// ---------------------------------------------------------------------------
// HITL authoring interface — Clinical Study Report (CSR)
// The thesis made operational: the model drafts, but a human reviews every
// claim, nothing is fabricated silently, every number is checked against the
// rest of the document, and no section ships until a person signs it off.
// ---------------------------------------------------------------------------

const C = {
  ink: "#14181D", paper: "#FBFAF8", canvas: "#FFFFFF", line: "#DDE0E2",
  dim: "#6B7580", trace: "#2F6F6A", traceW: "#DEEDEB",
  flag: "#B4532A", flagW: "#F5E6DF", approved: "#3F7A54", approvedW: "#E2EFE6",
  ai: "#9AA4AD",
  // provenance / source-function accents (from the reuse matrix)
  design: "#7A4A7E", clindata: "#2F6F6A", clinpharm: "#3C5AA6",
};

// section pipeline
const SECTIONS = [
  { id: "syn", num: "2", title: "Synopsis", status: "approved" },
  { id: "meth", num: "9", title: "Study Design & Methods", status: "approved" },
  { id: "pop", num: "10", title: "Study Population", status: "approved" },
  { id: "eff", num: "11", title: "Efficacy Evaluation", status: "review" },
  { id: "saf", num: "12", title: "Safety Evaluation", status: "drafting" },
  { id: "disc", num: "13", title: "Discussion & Conclusions", status: "empty" },
];

// initial content, keyed by section. Each sentence carries grounding, provenance,
// and optionally an open suggestion / consistency flag / cold-start gap.
const INITIAL = {
  pop: [
    { id: "p1", prov: "approved",
      text: "The intent-to-treat (ITT) population comprised 248 randomized patients.",
      src: { block: "Disposition / patient flow", set: "ADaM ADSL", fn: "clindata", detail: "ADSL where RANDFL='Y' → N=248" } },
    { id: "p2", prov: "approved",
      text: "Baseline demographic and disease characteristics were balanced between the two treatment arms.",
      src: { block: "Demographics & baseline (Table 1)", set: "ADaM ADSL", fn: "clindata", detail: "Table 14.1.2 — baseline characteristics" } },
  ],
  eff: [
    { id: "e1", prov: "approved",
      text: "The primary efficacy endpoint was progression-free survival (PFS) assessed by blinded independent central review.",
      src: { block: "Endpoints & estimands", set: "Protocol §8.1 / SAP", fn: "design", detail: "Protocol-defined primary endpoint; estimand per ICH E9(R1)" } },
    { id: "e2", prov: "ai",
      text: "A total of 250 patients were randomized 1:1 to Drug A (n=124) or placebo (n=124).",
      src: { block: "Disposition / patient flow", set: "ADaM ADSL", fn: "clindata", detail: "ADSL randomized count" },
      flag: { type: "consistency", msg: "This states 250, but the ITT population in §10 (Study Population) and Module 2.7 both state 248.", fixTo: "248", where: "§10 Study Population · Module 2.7" } },
    { id: "e3", prov: "ai",
      text: "Drug A demonstrated a statistically significant improvement in PFS versus placebo (HR 0.62; 95% CI 0.48–0.80; p<0.001).",
      src: { block: "Primary efficacy result", set: "ADaM ADEFF → Table 14.2.1", fn: "clindata", detail: "Primary PFS analysis, stratified Cox model" },
      suggestion: { proposed: "Drug A demonstrated a statistically significant improvement in PFS versus placebo (median 9.8 vs 6.1 months; HR 0.62; 95% CI 0.48–0.80; p<0.001).",
        rationale: "The efficacy table (14.2.1) reports median PFS for both arms. Including the medians here matches the source table and the value reused in Module 2.7 and the label." } },
    { id: "e4", prov: "ai",
      text: "The treatment effect was consistent across prespecified subgroups.",
      src: { block: "Primary efficacy result", set: "ADaM ADEFF → Figure 14.2.4", fn: "clindata", detail: "Subgroup forest plot" } },
  ],
  saf: [
    { id: "s1", prov: "ai",
      text: "Treatment-emergent adverse events (TEAEs) were reported in 92% of Drug A patients and 78% of placebo patients.",
      src: { block: "Adverse-event / TEAE tables", set: "ADaM ADAE → Table 14.3.1", fn: "clindata", detail: "Any-grade TEAE incidence by arm" } },
    { id: "s2", prov: "ai",
      text: "The most frequently reported Grade ≥3 TEAE was neutropenia.",
      src: { block: "Adverse-event / TEAE tables", set: "ADaM ADAE → Table 14.3.3", fn: "clindata", detail: "Grade ≥3 TEAE by preferred term" } },
    { id: "s3", prov: "gap", needsInput: true,
      text: "[ Narrative required — Serious adverse event (Grade 5), Subject 1042-0087. No matching narrative was found in the safety database export. Human authoring required before this section can be drafted. ]",
      src: null },
  ],
};

// approved sections we don't author here but can display read-only
const READONLY = {
  syn: "This section has been reviewed and approved. Synopsis content is generated last, assembled from the approved Efficacy and Safety sections.",
  meth: "This section has been reviewed and approved. Methods are transformed from the protocol and SAP (see §11 grounding).",
};

const FN_COLOR = { design: C.design, clindata: C.clindata, clinpharm: C.clinpharm };

export default function App() {
  const [content, setContent] = useState(INITIAL);
  const [sections, setSections] = useState(SECTIONS);
  const [activeSec, setActiveSec] = useState("eff");
  const [selId, setSelId] = useState("e2");
  const [tab, setTab] = useState("ground");

  const secMeta = sections.find((s) => s.id === activeSec);
  const list = content[activeSec] || [];
  const selected = list.find((x) => x.id === selId) || null;

  // open items = anything requiring a human before the section can be approved
  const openItems = useMemo(() => {
    return list.filter((s) => s.suggestion || s.flag || s.needsInput);
  }, [list]);

  const approvedCount = sections.filter((s) => s.status === "approved").length;

  function mutate(secId, id, fn) {
    setContent((prev) => ({
      ...prev,
      [secId]: prev[secId].map((s) => (s.id === id ? fn(s) : s)),
    }));
  }

  function acceptSuggestion(id) {
    mutate(activeSec, id, (s) => ({ ...s, text: s.suggestion.proposed, prov: "edited", suggestion: undefined }));
  }
  function rejectSuggestion(id) {
    mutate(activeSec, id, (s) => ({ ...s, prov: "edited", suggestion: undefined }));
  }
  function reconcile(id) {
    mutate(activeSec, id, (s) => ({
      ...s,
      text: s.text.replace("250", s.flag.fixTo),
      prov: "edited",
      flag: undefined,
    }));
  }

  function approveSection() {
    if (openItems.length > 0) return;
    setContent((prev) => ({
      ...prev,
      [activeSec]: prev[activeSec].map((s) => ({ ...s, prov: s.prov === "gap" ? s.prov : "approved" })),
    }));
    setSections((prev) => prev.map((s) => (s.id === activeSec ? { ...s, status: "approved" } : s)));
  }

  const statusMeta = {
    approved: { c: C.approved, w: C.approvedW, label: "Approved" },
    review: { c: C.flag, w: C.flagW, label: "In review" },
    drafting: { c: C.trace, w: C.traceW, label: "Drafting" },
    empty: { c: C.dim, w: "#EEF0F1", label: "Not started" },
  };

  return (
    <div style={S.root}>
      <style>{css}</style>

      {/* top bar */}
      <div style={S.topbar}>
        <div style={S.brand}>
          <span style={S.mark}>‖</span>
          <div>
            <div style={S.docTitle}>Clinical Study Report — Study APEX-301</div>
            <div style={S.docSub}>Drug A vs placebo · Phase 3 · ICH E3 structure</div>
          </div>
        </div>
        <div style={S.topRight}>
          <span style={S.badge}>◇ Validated environment · 21 CFR Part 11</span>
          <span style={S.modelChip}>drafted by model · human-reviewed</span>
          <span style={S.progress}>{approvedCount}/{sections.length} sections approved</span>
        </div>
      </div>

      <div style={S.body}>
        {/* LEFT — outline / pipeline */}
        <aside style={S.outline}>
          <div style={S.outlineHead}>Document outline</div>
          {sections.map((s) => {
            const sm = statusMeta[s.status];
            const isActive = s.id === activeSec;
            const open = (content[s.id] || []).filter((x) => x.suggestion || x.flag || x.needsInput).length;
            return (
              <button
                key={s.id}
                onClick={() => { setActiveSec(s.id); const first = (content[s.id] || [])[0]; setSelId(first ? first.id : null); }}
                className={isActive ? "secBtn active" : "secBtn"}
                style={{ "--sc": sm.c }}
              >
                <span style={{ ...S.statusDot, background: sm.c }} />
                <span style={S.secNum}>{s.num}</span>
                <span style={S.secTitle}>{s.title}</span>
                {open > 0 && <span style={S.openPill}>{open}</span>}
              </button>
            );
          })}
          <div style={S.legend}>
            {Object.values(statusMeta).map((m) => (
              <div key={m.label} style={S.legendRow}>
                <span style={{ ...S.legendDot, background: m.c }} /> {m.label}
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER — drafting canvas */}
        <main style={S.canvasWrap}>
          <div style={S.canvasHead}>
            <div>
              <div style={S.canvasKicker}>Section {secMeta.num}</div>
              <div style={S.canvasTitle}>{secMeta.title}</div>
            </div>
            <div style={{ ...S.secStatus, background: statusMeta[secMeta.status].w, color: statusMeta[secMeta.status].c }}>
              {statusMeta[secMeta.status].label}
            </div>
          </div>

          <div style={S.canvas}>
            {READONLY[activeSec] ? (
              <div style={S.readonly}>{READONLY[activeSec]}</div>
            ) : list.length === 0 ? (
              <div style={S.readonly}>This section has not been drafted yet.</div>
            ) : (
              <p style={S.prose}>
                {list.map((s) => {
                  let cls = "sent";
                  if (s.id === selId) cls += " sel";
                  if (s.suggestion) cls += " hasSug";
                  if (s.flag) cls += " hasFlag";
                  if (s.needsInput) cls += " gap";
                  else cls += " prov-" + s.prov;
                  return (
                    <span
                      key={s.id}
                      className={cls}
                      onClick={() => { setSelId(s.id); setTab(s.flag ? "checks" : "ground"); }}
                    >
                      {s.text}{" "}
                    </span>
                  );
                })}
              </p>
            )}
          </div>

          {/* approval gate */}
          {!READONLY[activeSec] && list.length > 0 && (
            <div style={S.gate}>
              <div style={S.gateNote}>
                {openItems.length === 0
                  ? "All claims grounded, checked, and resolved. Ready for sign-off."
                  : `${openItems.length} open item${openItems.length > 1 ? "s" : ""} require a human before this section can be approved.`}
              </div>
              <button
                className={openItems.length === 0 ? "approveBtn ready" : "approveBtn"}
                disabled={openItems.length !== 0}
                onClick={approveSection}
              >
                {secMeta.status === "approved" ? "✓ Section approved" : "Approve section"}
              </button>
            </div>
          )}
        </main>

        {/* RIGHT — inspector */}
        <aside style={S.inspector}>
          {!selected ? (
            <div style={S.inspEmpty}>Select a sentence to inspect its source, history, and checks.</div>
          ) : (
            <>
              <div style={S.inspTabs}>
                {[["ground", "Grounding"], ["prov", "History"], ["checks", "Checks"]].map(([k, lab]) => (
                  <button key={k} className={tab === k ? "itab on" : "itab"} onClick={() => setTab(k)}>
                    {lab}
                    {k === "checks" && (selected.flag || selected.needsInput) && <span style={S.tabDot} />}
                  </button>
                ))}
              </div>

              <div style={S.inspBody}>
                {/* the selected sentence echoed */}
                <div style={S.selEcho}>“{selected.needsInput ? "Cold-start gap — see below" : selected.text}”</div>

                {tab === "ground" && (
                  selected.src ? (
                    <div>
                      <Field k="Building block" v={
                        <span style={{ ...S.fnChip, color: FN_COLOR[selected.src.fn], background: "#F4F2EE" }}>
                          {selected.src.block}
                        </span>} />
                      <Field k="Source of truth" v={selected.src.set} />
                      <Field k="Trace" v={selected.src.detail} />
                      <div style={S.srcCard}>
                        <div style={S.srcCardHead}>▸ source · {selected.src.set}</div>
                        <div style={S.srcCardBody}>
                          Every value in this sentence resolves to the dataset above. Editing the source
                          re-flows the number everywhere this block appears.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={S.gapNote}>
                      No source is linked to this item. The model did not find a matching record and has
                      declined to draft it rather than fabricate content.
                    </div>
                  )
                )}

                {tab === "prov" && (
                  <ul style={S.trail}>
                    {provTrail(selected).map((t, i) => (
                      <li key={i} style={S.trailItem}>
                        <span style={{ ...S.trailDot, background: t.color }} />
                        <div>
                          <div style={S.trailWhat}>{t.what}</div>
                          <div style={S.trailWhen}>{t.when}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {tab === "checks" && (
                  <div>
                    {selected.flag ? (
                      <div style={S.checkCard}>
                        <div style={S.checkHead}>⚠ Consistency conflict</div>
                        <div style={S.checkMsg}>{selected.flag.msg}</div>
                        <div style={S.checkWhere}>Conflicts with: {selected.flag.where}</div>
                        <button className="fixBtn" onClick={() => { reconcile(selected.id); }}>
                          Reconcile to {selected.flag.fixTo}
                        </button>
                      </div>
                    ) : selected.needsInput ? (
                      <div style={S.checkCard}>
                        <div style={S.checkHead}>⚠ Missing source — human required</div>
                        <div style={S.checkMsg}>
                          The model flagged a required safety narrative it cannot ground in the data export.
                          It will not generate unsourced safety content. A writer must author this before
                          the Safety section can be approved.
                        </div>
                      </div>
                    ) : (
                      <div style={S.checkOk}>✓ No open checks on this claim. Grounded and internally consistent.</div>
                    )}
                  </div>
                )}
              </div>

              {/* action row for open suggestions */}
              {selected.suggestion && (
                <div style={S.sugCard}>
                  <div style={S.sugHead}>◆ Suggested revision</div>
                  <div style={S.sugProposed}>{selected.suggestion.proposed}</div>
                  <div style={S.sugRationale}>{selected.suggestion.rationale}</div>
                  <div style={S.sugActions}>
                    <button className="accept" onClick={() => acceptSuggestion(selected.id)}>Accept</button>
                    <button className="reject" onClick={() => rejectSuggestion(selected.id)}>Keep original</button>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ k, v }) {
  return (
    <div style={S.field}>
      <div style={S.fieldK}>{k}</div>
      <div style={S.fieldV}>{v}</div>
    </div>
  );
}

function provTrail(s) {
  if (s.needsInput) return [{ what: "Flagged as cold-start gap by model", when: "no source found", color: C.flag }];
  const base = [{ what: "Drafted by model", when: "grounded in source dataset", color: C.ai }];
  if (s.prov === "ai") return base;
  if (s.prov === "edited") return [...base, { what: "Edited by reviewer", when: "just now", color: C.trace }];
  if (s.prov === "approved")
    return [...base, { what: "Edited by reviewer", when: "earlier", color: C.trace },
      { what: "Approved by reviewer", when: "signed off", color: C.approved }];
  return base;
}

const S = {
  root: { background: C.paper, color: C.ink, minHeight: "100vh", fontFamily: "'Newsreader', Georgia, serif" },
  topbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
    padding: "12px clamp(12px,3vw,28px)", borderBottom: `2px solid ${C.ink}`, flexWrap: "wrap" },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  mark: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 22, color: C.trace },
  docTitle: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" },
  docSub: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.dim, marginTop: 2 },
  topRight: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  badge: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.approved,
    background: C.approvedW, padding: "4px 9px", borderRadius: 4, letterSpacing: "0.03em" },
  modelChip: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.dim,
    border: `1px solid ${C.line}`, padding: "4px 9px", borderRadius: 4 },
  progress: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.ink, letterSpacing: "0.03em" },

  body: { display: "grid", gridTemplateColumns: "232px minmax(0,1fr) 340px", alignItems: "start", minHeight: "calc(100vh - 60px)" },

  // outline
  outline: { borderRight: `1px solid ${C.line}`, padding: "16px 12px", position: "sticky", top: 0 },
  outlineHead: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, textTransform: "uppercase",
    letterSpacing: "0.12em", color: C.dim, padding: "0 6px 10px" },
  statusDot: { width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto" },
  secNum: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.dim, width: 16, flex: "0 0 auto" },
  secTitle: { fontSize: 14, flex: 1, textAlign: "left" },
  openPill: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, background: C.flagW, color: C.flag,
    borderRadius: 10, padding: "1px 7px", flex: "0 0 auto" },
  legend: { marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 6 },
  legendRow: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.dim, display: "flex", alignItems: "center", gap: 8 },
  legendDot: { width: 7, height: 7, borderRadius: "50%" },

  // canvas
  canvasWrap: { padding: "20px clamp(14px,3vw,36px)", minWidth: 0 },
  canvasHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  canvasKicker: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", color: C.dim },
  canvasTitle: { fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em", marginTop: 4 },
  secStatus: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, padding: "5px 11px", borderRadius: 5, letterSpacing: "0.03em" },
  canvas: { background: C.canvas, border: `1px solid ${C.line}`, borderRadius: 8, padding: "30px 34px", minHeight: 220 },
  prose: { fontSize: 18, lineHeight: 2.0, margin: 0, color: C.ink },
  readonly: { fontSize: 15, lineHeight: 1.7, color: C.dim, fontStyle: "italic" },

  gate: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14,
    marginTop: 16, padding: "12px 16px", background: C.canvas, border: `1px solid ${C.line}`, borderRadius: 8, flexWrap: "wrap" },
  gateNote: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.dim, lineHeight: 1.4, flex: 1, minWidth: 200 },

  // inspector
  inspector: { borderLeft: `1px solid ${C.line}`, padding: "16px 16px 28px", position: "sticky", top: 0, alignSelf: "stretch" },
  inspEmpty: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.dim, lineHeight: 1.6, padding: "20px 4px" },
  inspTabs: { display: "flex", gap: 4, borderBottom: `1px solid ${C.line}`, marginBottom: 14 },
  tabDot: { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.flag, marginLeft: 6, verticalAlign: "middle" },
  inspBody: {},
  selEcho: { fontSize: 15, lineHeight: 1.55, color: "#2a343d", fontStyle: "italic",
    borderLeft: `3px solid ${C.line}`, paddingLeft: 12, marginBottom: 16 },
  field: { marginBottom: 12 },
  fieldK: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, textTransform: "uppercase",
    letterSpacing: "0.1em", color: C.dim, marginBottom: 4 },
  fieldV: { fontSize: 13.5, lineHeight: 1.4, fontFamily: "'IBM Plex Mono',monospace" },
  fnChip: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, padding: "3px 8px", borderRadius: 4 },
  srcCard: { marginTop: 8, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.trace}`, borderRadius: 5, overflow: "hidden" },
  srcCardHead: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.trace, padding: "8px 11px", borderBottom: `1px solid ${C.line}`, background: C.traceW },
  srcCardBody: { fontSize: 12.5, lineHeight: 1.5, color: "#33414c", padding: "10px 11px" },
  gapNote: { fontSize: 13, lineHeight: 1.55, color: C.flag, background: C.flagW,
    border: `1px solid #E7C9BC`, borderRadius: 5, padding: "11px 12px" },

  trail: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 },
  trailItem: { display: "flex", gap: 10, alignItems: "flex-start" },
  trailDot: { width: 9, height: 9, borderRadius: "50%", marginTop: 4, flex: "0 0 auto" },
  trailWhat: { fontSize: 13.5 },
  trailWhen: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.dim, marginTop: 1 },

  checkCard: { border: `1px solid #E7C9BC`, borderLeft: `3px solid ${C.flag}`, borderRadius: 5, padding: "12px 13px", background: C.flagW },
  checkHead: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: C.flag, letterSpacing: "0.02em", marginBottom: 7 },
  checkMsg: { fontSize: 13, lineHeight: 1.5, color: "#43301f" },
  checkWhere: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: C.flag, marginTop: 8 },
  checkOk: { fontSize: 13, lineHeight: 1.5, color: C.approved, background: C.approvedW,
    border: `1px solid #C6DECD`, borderRadius: 5, padding: "11px 12px" },

  sugCard: { marginTop: 16, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.trace}`, borderRadius: 6, padding: "13px 14px", background: C.canvas },
  sugHead: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.trace, letterSpacing: "0.04em", marginBottom: 8 },
  sugProposed: { fontSize: 14, lineHeight: 1.55, color: C.ink, background: C.traceW, borderRadius: 5, padding: "9px 11px" },
  sugRationale: { fontSize: 12.5, lineHeight: 1.5, color: C.dim, marginTop: 9 },
  sugActions: { display: "flex", gap: 8, marginTop: 12 },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap');
* { -webkit-font-smoothing: antialiased; box-sizing: border-box; }

.secBtn { display:flex; align-items:center; gap:9px; width:100%; border:none; background:none;
  padding:8px 6px; border-radius:6px; cursor:pointer; margin-bottom:2px; transition:background .13s;
  border-left:3px solid transparent; font-family:'Newsreader',serif; }
.secBtn:hover { background:#fff; }
.secBtn.active { background:#fff; border-left-color:var(--sc); box-shadow:0 1px 0 rgba(20,24,29,.04); }

.sent { cursor:pointer; border-radius:3px; padding:1px 2px; transition:background .14s, box-shadow .14s;
  box-decoration-break:clone; -webkit-box-decoration-break:clone; }
.sent:hover { background:#F4F2EE; }
.sent.sel { background:${C.traceW}; box-shadow:0 0 0 2px ${C.traceW}; }
.sent.prov-ai { border-bottom:2px solid ${C.ai}55; }
.sent.prov-edited { border-bottom:2px solid ${C.trace}; }
.sent.prov-approved { border-bottom:2px solid ${C.approved}66; }
.sent.hasSug { border-bottom:2px dotted ${C.trace}; background:${C.traceW}55; }
.sent.hasFlag { text-decoration:underline wavy ${C.flag}; text-underline-offset:4px; background:${C.flagW}; }
.sent.gap { display:block; margin:2px 0; padding:10px 12px; background:${C.flagW};
  border:1px dashed ${C.flag}; border-radius:5px; color:${C.flag}; font-size:15px; line-height:1.5; font-style:italic; }

.itab { flex:1; font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.02em;
  padding:8px 4px; border:none; background:none; color:${C.dim}; cursor:pointer; border-bottom:2px solid transparent; }
.itab.on { color:${C.ink}; border-bottom-color:${C.ink}; }

.approveBtn { font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:.03em; padding:9px 16px;
  border:1px solid ${C.line}; background:transparent; color:${C.dim}; border-radius:5px; cursor:not-allowed; white-space:nowrap; }
.approveBtn.ready { background:${C.approved}; border-color:${C.approved}; color:#fff; cursor:pointer; }

.accept { font-family:'IBM Plex Mono',monospace; font-size:12px; padding:7px 14px; border:1px solid ${C.trace};
  background:${C.trace}; color:#fff; border-radius:5px; cursor:pointer; }
.reject { font-family:'IBM Plex Mono',monospace; font-size:12px; padding:7px 14px; border:1px solid ${C.line};
  background:#fff; color:${C.dim}; border-radius:5px; cursor:pointer; }
.fixBtn { margin-top:11px; font-family:'IBM Plex Mono',monospace; font-size:12px; padding:7px 14px;
  border:1px solid ${C.flag}; background:${C.flag}; color:#fff; border-radius:5px; cursor:pointer; }

@media (max-width: 1000px){
  .secBtn{font-size:13px}
}
@media (prefers-reduced-motion: reduce){ * { transition:none !important; } }
`;
