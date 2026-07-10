import React, { useState, useMemo, useRef } from "react";

// ---------------------------------------------------------------------------
// Patient Safety Narrative — grounded generation demo
// The argument this makes visual: in regulated authoring the moat is not
// generation, it's *grounding*. Every generated sentence must trace back to a
// source datum, and nothing ships until a human signs off on each claim.
// ---------------------------------------------------------------------------

// Palette — clinical, cool, auditable. Not cream/terracotta.
// ink       #10161C  near-black slate
// paper     #FBFAF7  warm off-white for the writing surface
// panel     #0E1620  data panel (dark, "system of record")
// line      #D8DCE0  hairline
// trace     #2F6F6A  teal — the grounding/trace accent
// traceGlow #CFE7E3  light teal wash for highlighted source
// flag      #B4532A  muted rust — unverified / needs review
// ok        #2F6F6A
const C = {
  ink: "#10161C",
  paper: "#FBFAF7",
  panel: "#0E1620",
  panelText: "#C6D0D8",
  panelDim: "#7E8C97",
  line: "#D8DCE0",
  trace: "#2F6F6A",
  traceGlow: "#CFE7E3",
  flag: "#B4532A",
  flagGlow: "#F3E2DA",
};

// --- Mock source record. Fields mimic SDTM/ADaM-style structured safety data.
const DEFAULT_RECORD = {
  subjectId: "1042-0087",
  demographics: { age: 61, sex: "Male", race: "White", arm: "Drug A 200mg QD" },
  dosing: {
    drug: "Drug A",
    dose: "200 mg",
    freq: "once daily",
    startDay: 1,
    lastDay: 84,
  },
  events: [
    {
      id: "AE001",
      term: "Neutropenia",
      grade: 3,
      serious: true,
      startDay: 43,
      endDay: 58,
      outcome: "Recovered",
      action: "Drug interrupted",
      related: "Probably related",
    },
    {
      id: "AE002",
      term: "Fatigue",
      grade: 2,
      serious: false,
      startDay: 12,
      endDay: null,
      outcome: "Ongoing",
      action: "Dose unchanged",
      related: "Possibly related",
    },
  ],
  labs: [
    { id: "LB001", test: "Absolute neutrophil count", value: "0.8", unit: "10^9/L", day: 43, flag: "Low" },
    { id: "LB002", test: "Hemoglobin", value: "11.2", unit: "g/dL", day: 43, flag: "Low" },
  ],
  medHistory: ["Type 2 diabetes mellitus", "Hypertension"],
  conmeds: ["Metformin", "Lisinopril"],
};

// Each generated sentence is an object carrying the source field ids it draws
// from. In a real system the model returns these spans; here we author them so
// the traceability interaction is fully demonstrable offline.
const SEED_NARRATIVE = [
  {
    id: "S1",
    text:
      "Subject 1042-0087 is a 61-year-old White male enrolled in the Drug A 200 mg once-daily treatment arm.",
    sources: ["subjectId", "demographics.age", "demographics.race", "demographics.sex", "demographics.arm"],
    verified: false,
  },
  {
    id: "S2",
    text:
      "Relevant medical history included type 2 diabetes mellitus and hypertension, managed with metformin and lisinopril.",
    sources: ["medHistory", "conmeds"],
    verified: false,
  },
  {
    id: "S3",
    text:
      "The subject began study drug on Day 1 and continued through Day 84.",
    sources: ["dosing.startDay", "dosing.lastDay", "dosing.drug"],
    verified: false,
  },
  {
    id: "S4",
    text:
      "On Day 43, the subject experienced a serious Grade 3 event of neutropenia, coincident with an absolute neutrophil count of 0.8 ×10\u2079/L.",
    sources: ["AE001", "LB001"],
    verified: false,
  },
  {
    id: "S5",
    text:
      "Study drug was interrupted; the event was assessed as probably related to study drug and had resolved by Day 58.",
    sources: ["AE001"],
    verified: false,
  },
  {
    id: "S6",
    text:
      "A concurrent Grade 2 event of fatigue, first reported on Day 12 and considered possibly related, remained ongoing at the time of this report.",
    sources: ["AE002"],
    verified: false,
  },
];

// Map a source id to a human label + the panel region it lives in, so hovering
// a sentence can light up the right cell.
function sourceLabel(id, record) {
  if (id === "subjectId") return `Subject ID · ${record.subjectId}`;
  if (id.startsWith("demographics.")) {
    const k = id.split(".")[1];
    return `Demographics · ${k} · ${record.demographics[k]}`;
  }
  if (id.startsWith("dosing.")) {
    const k = id.split(".")[1];
    return `Dosing · ${k} · ${record.dosing[k]}`;
  }
  if (id === "medHistory") return `Medical history · ${record.medHistory.join(", ")}`;
  if (id === "conmeds") return `Concomitant meds · ${record.conmeds.join(", ")}`;
  const ev = record.events.find((e) => e.id === id);
  if (ev) return `Adverse event · ${ev.term} (Grade ${ev.grade})`;
  const lb = record.labs.find((l) => l.id === id);
  if (lb) return `Lab · ${lb.test} · ${lb.value} ${lb.unit}`;
  return id;
}

export default function App() {
  const [record] = useState(DEFAULT_RECORD);
  const [sentences, setSentences] = useState(SEED_NARRATIVE);
  const [active, setActive] = useState(null); // active sentence id (hover/focus)
  const [selected, setSelected] = useState(null); // clicked/pinned sentence id
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [tone, setTone] = useState("regulatory"); // regulatory | plain
  const liveRef = useRef(null);

  const focusId = selected || active;
  const focusSources = useMemo(() => {
    if (!focusId) return new Set();
    const s = sentences.find((x) => x.id === focusId);
    return new Set(s ? s.sources : []);
  }, [focusId, sentences]);

  const verifiedCount = sentences.filter((s) => s.verified).length;
  const allVerified = verifiedCount === sentences.length && sentences.length > 0;

  function toggleVerify(id) {
    setSentences((prev) =>
      prev.map((s) => (s.id === id ? { ...s, verified: !s.verified } : s))
    );
  }

  // Live regeneration via the Anthropic API. The model is asked to return
  // STRICT JSON: an array of {text, sources}. We keep sources constrained to the
  // known field ids so traceability stays intact. This is the "grounded
  // generation" contract a real product would enforce.
  async function regenerate() {
    setGenerating(true);
    setGenError(null);
    const fieldIds = [
      "subjectId",
      "demographics.age", "demographics.sex", "demographics.race", "demographics.arm",
      "dosing.drug", "dosing.dose", "dosing.freq", "dosing.startDay", "dosing.lastDay",
      "medHistory", "conmeds",
      ...record.events.map((e) => e.id),
      ...record.labs.map((l) => l.id),
    ];
    const sys =
      "You are a medical writer generating an ICH E3 patient safety narrative from structured clinical data. " +
      "Every sentence you output MUST be fully supported by the provided source fields — never introduce facts not present in the data. " +
      "Return ONLY valid JSON, no markdown, no preamble: an array of objects, each {\"text\": string, \"sources\": string[]}. " +
      "The 'sources' array must contain only ids from this allowed list: " + JSON.stringify(fieldIds) + ". " +
      (tone === "plain"
        ? "Use plain, patient-accessible language while remaining accurate."
        : "Use precise regulatory register consistent with a Clinical Study Report narrative.");
    const user =
      "Generate a patient safety narrative (5-7 sentences) from this record:\n" +
      JSON.stringify(record, null, 2);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: sys + "\n\n" + user }],
        }),
      });
      const data = await res.json();
      const raw = (data.content || [])
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .replace(/```json|```/g, "")
        .trim();
      const parsed = JSON.parse(raw);
      const next = parsed.map((p, i) => ({
        id: "G" + (i + 1),
        text: p.text,
        sources: Array.isArray(p.sources) ? p.sources.filter((s) => fieldIds.includes(s)) : [],
        verified: false,
      }));
      if (next.length) setSentences(next);
      else setGenError("Model returned no usable sentences. Showing the previous draft.");
    } catch (e) {
      setGenError(
        "Couldn't reach the model in this environment, so this is the seeded draft. The traceability, verification, and grounding UX all work regardless — regenerate is the only piece that needs a live connection."
      );
    } finally {
      setGenerating(false);
    }
  }

  // --- source cell rendering helper: is this field id currently lit?
  const lit = (id) => focusSources.has(id);

  return (
    <div style={styles.root}>
      <style>{css}</style>

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.brandRow}>
          <span style={styles.mark}>◐</span>
          <span style={styles.brandName}>Narrative</span>
          <span style={styles.brandSlash}>/</span>
          <span style={styles.brandSub}>grounded patient safety narratives</span>
        </div>
        <div style={styles.headerMeta}>
          <span style={styles.metaItem}>ICH&nbsp;E3&nbsp;§12.3</span>
          <span style={styles.metaDot}>·</span>
          <span style={styles.metaItem}>source&nbsp;of&nbsp;record&nbsp;linked</span>
        </div>
      </header>

      <p style={styles.lede}>
        Every sentence is tied to the data it came from. Hover a line to see its
        sources light up in the record; a narrative can't be approved until a
        reviewer verifies each grounded claim.
      </p>

      <div style={styles.grid}>
        {/* LEFT — the source record (system of record) */}
        <section style={styles.panel} aria-label="Structured source record">
          <div style={styles.panelHead}>
            <span style={styles.panelKicker}>Source record</span>
            <span style={styles.subjectTag}>Subject {record.subjectId}</span>
          </div>

          <FieldBlock title="Demographics">
            <Cell lit={lit("demographics.age")} k="Age" v={`${record.demographics.age} yr`} />
            <Cell lit={lit("demographics.sex")} k="Sex" v={record.demographics.sex} />
            <Cell lit={lit("demographics.race")} k="Race" v={record.demographics.race} />
            <Cell lit={lit("demographics.arm")} k="Arm" v={record.demographics.arm} full />
          </FieldBlock>

          <FieldBlock title="Dosing">
            <Cell lit={lit("dosing.drug")} k="Drug" v={record.dosing.drug} />
            <Cell lit={lit("dosing.dose")} k="Dose" v={record.dosing.dose} />
            <Cell lit={lit("dosing.freq")} k="Freq" v={record.dosing.freq} />
            <Cell lit={lit("dosing.startDay")} k="Start" v={`Day ${record.dosing.startDay}`} />
            <Cell lit={lit("dosing.lastDay")} k="Last" v={`Day ${record.dosing.lastDay}`} />
          </FieldBlock>

          <FieldBlock title="Adverse events">
            {record.events.map((e) => (
              <div key={e.id} className={lit(e.id) ? "srcRow lit" : "srcRow"} style={styles.aeRow}>
                <div style={styles.aeTop}>
                  <span style={styles.aeTerm}>{e.term}</span>
                  <span style={styles.aeGrade}>G{e.grade}{e.serious ? " · SAE" : ""}</span>
                </div>
                <div style={styles.aeMeta}>
                  Day {e.startDay}{e.endDay ? `–${e.endDay}` : "+"} · {e.related} · {e.action}
                </div>
              </div>
            ))}
          </FieldBlock>

          <FieldBlock title="Labs (abnormal)">
            {record.labs.map((l) => (
              <div key={l.id} className={lit(l.id) ? "srcRow lit" : "srcRow"} style={styles.aeRow}>
                <div style={styles.aeTop}>
                  <span style={styles.aeTerm}>{l.test}</span>
                  <span style={styles.aeGrade}>{l.value} {l.unit}</span>
                </div>
                <div style={styles.aeMeta}>Day {l.day} · {l.flag}</div>
              </div>
            ))}
          </FieldBlock>

          <FieldBlock title="History / conmeds">
            <Cell lit={lit("medHistory")} k="Hx" v={record.medHistory.join(", ")} full />
            <Cell lit={lit("conmeds")} k="Meds" v={record.conmeds.join(", ")} full />
          </FieldBlock>
        </section>

        {/* RIGHT — the writing surface */}
        <section style={styles.writer} aria-label="Generated narrative">
          <div style={styles.writerHead}>
            <div style={styles.writerControls}>
              <div style={styles.toneToggle} role="group" aria-label="Register">
                <button
                  onClick={() => setTone("regulatory")}
                  className={tone === "regulatory" ? "toneBtn on" : "toneBtn"}
                >
                  Regulatory
                </button>
                <button
                  onClick={() => setTone("plain")}
                  className={tone === "plain" ? "toneBtn on" : "toneBtn"}
                >
                  Plain language
                </button>
              </div>
              <button onClick={regenerate} className="genBtn" disabled={generating}>
                {generating ? "Generating…" : "⟲ Regenerate"}
              </button>
            </div>
            <div style={styles.progressWrap} aria-live="polite">
              <div style={styles.progressLabel}>
                {verifiedCount}/{sentences.length} claims verified
              </div>
              <div style={styles.progressTrack}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${(verifiedCount / Math.max(sentences.length, 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {genError && <div style={styles.notice}>{genError}</div>}

          <article style={styles.doc} ref={liveRef}>
            <div style={styles.docTitle}>
              Narrative — Subject {record.subjectId}
            </div>
            <p style={styles.docBody}>
              {sentences.map((s) => {
                const isFocus = focusId === s.id;
                const cls =
                  "sent" +
                  (isFocus ? " focus" : "") +
                  (s.verified ? " verified" : " unverified");
                return (
                  <span
                    key={s.id}
                    className={cls}
                    tabIndex={0}
                    onMouseEnter={() => setActive(s.id)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(s.id)}
                    onBlur={() => setActive(null)}
                    onClick={() => setSelected(selected === s.id ? null : s.id)}
                  >
                    {s.text}{" "}
                  </span>
                );
              })}
            </article>

          {/* Inspector for the pinned sentence */}
          {selected && (() => {
            const s = sentences.find((x) => x.id === selected);
            if (!s) return null;
            return (
              <div style={styles.inspector}>
                <div style={styles.inspectorHead}>
                  <span style={styles.inspectorKicker}>Grounding for this claim</span>
                  <button className="pinClose" onClick={() => setSelected(null)}>✕</button>
                </div>
                <ul style={styles.srcList}>
                  {s.sources.map((src) => (
                    <li key={src} style={styles.srcListItem}>
                      <span style={styles.srcDot} />
                      {sourceLabel(src, record)}
                    </li>
                  ))}
                </ul>
                <button
                  className={s.verified ? "verifyBtn done" : "verifyBtn"}
                  onClick={() => toggleVerify(s.id)}
                >
                  {s.verified ? "✓ Verified — click to unverify" : "Verify against source"}
                </button>
              </div>
            );
          })()}
        </section>
      </div>

      {/* Footer bar — the approval gate */}
      <footer style={styles.footer}>
        <div style={styles.footNote}>
          {allVerified
            ? "All claims traced and verified. This draft is eligible for reviewer sign-off."
            : "Approval is gated on verification. Unverified claims are flagged, not shippable."}
        </div>
        <button className={allVerified ? "approveBtn ready" : "approveBtn"} disabled={!allVerified}>
          {allVerified ? "Submit for QC" : `${sentences.length - verifiedCount} claim(s) left`}
        </button>
      </footer>
    </div>
  );
}

// --- small components -------------------------------------------------------
function FieldBlock({ title, children }) {
  return (
    <div style={styles.fieldBlock}>
      <div style={styles.fieldTitle}>{title}</div>
      <div style={styles.fieldGrid}>{children}</div>
    </div>
  );
}

function Cell({ k, v, lit, full }) {
  return (
    <div
      className={lit ? "srcRow lit" : "srcRow"}
      style={{ ...styles.cell, gridColumn: full ? "1 / -1" : "auto" }}
    >
      <span style={styles.cellK}>{k}</span>
      <span style={styles.cellV}>{v}</span>
    </div>
  );
}

// --- styles -----------------------------------------------------------------
const styles = {
  root: {
    background: C.paper,
    color: C.ink,
    minHeight: "100vh",
    padding: "28px clamp(16px, 4vw, 48px) 96px",
    fontFamily:
      "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    maxWidth: 1180,
    margin: "0 auto",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    borderBottom: `1.5px solid ${C.ink}`,
    paddingBottom: 12,
  },
  brandRow: { display: "flex", alignItems: "baseline", gap: 10 },
  mark: { color: C.trace, fontSize: 20, transform: "translateY(1px)" },
  brandName: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontWeight: 600,
    fontSize: 20,
    letterSpacing: "-0.02em",
  },
  brandSlash: { color: C.line, fontSize: 20 },
  brandSub: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 12.5,
    color: C.panelDim,
    letterSpacing: "0.01em",
  },
  headerMeta: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11.5,
    color: C.panelDim,
    display: "flex",
    gap: 8,
    alignItems: "center",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  metaDot: { color: C.line },
  lede: {
    fontSize: 15.5,
    lineHeight: 1.55,
    maxWidth: 620,
    margin: "18px 0 24px",
    color: "#33414C",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 0.85fr) minmax(320px, 1.15fr)",
    gap: 20,
    alignItems: "start",
  },
  // left panel
  panel: {
    background: C.panel,
    color: C.panelText,
    borderRadius: 4,
    padding: "18px 18px 22px",
    position: "sticky",
    top: 16,
  },
  panelHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottom: `1px solid #22303B`,
    paddingBottom: 10,
    marginBottom: 14,
  },
  panelKicker: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: C.panelDim,
  },
  subjectTag: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 12,
    color: C.traceGlow,
  },
  fieldBlock: { marginBottom: 16 },
  fieldTitle: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: C.panelDim,
    marginBottom: 7,
  },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 },
  cell: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: "5px 8px",
    borderRadius: 3,
  },
  cellK: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: C.panelDim,
  },
  cellV: { fontSize: 13.5, color: C.panelText, lineHeight: 1.3 },
  aeRow: { padding: "7px 8px", borderRadius: 3, marginBottom: 3 },
  aeTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  aeTerm: { fontSize: 13.5, color: C.panelText },
  aeGrade: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11,
    color: C.traceGlow,
    whiteSpace: "nowrap",
  },
  aeMeta: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 10.5,
    color: C.panelDim,
    marginTop: 2,
  },
  // right / writer
  writer: { display: "flex", flexDirection: "column", gap: 0 },
  writerHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  writerControls: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  toneToggle: {
    display: "inline-flex",
    border: `1px solid ${C.line}`,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressWrap: { minWidth: 160 },
  progressLabel: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11,
    color: "#5B6873",
    marginBottom: 5,
    textAlign: "right",
    letterSpacing: "0.04em",
  },
  progressTrack: {
    height: 3,
    background: C.line,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", background: C.trace, transition: "width .35s ease" },
  notice: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 12,
    lineHeight: 1.5,
    color: C.flag,
    background: C.flagGlow,
    border: `1px solid #E7C9BC`,
    borderRadius: 4,
    padding: "9px 11px",
    marginBottom: 14,
  },
  doc: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 4,
    padding: "26px 28px",
    boxShadow: "0 1px 0 rgba(16,22,28,0.03)",
  },
  docTitle: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: C.panelDim,
    borderBottom: `1px solid ${C.line}`,
    paddingBottom: 10,
    marginBottom: 16,
  },
  docBody: { fontSize: 17, lineHeight: 1.85, margin: 0, color: C.ink },
  inspector: {
    marginTop: 16,
    border: `1px solid ${C.line}`,
    borderLeft: `3px solid ${C.trace}`,
    borderRadius: 4,
    padding: "14px 16px",
    background: "#fff",
  },
  inspectorHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  inspectorKicker: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: C.trace,
  },
  srcList: { listStyle: "none", padding: 0, margin: "0 0 14px" },
  srcListItem: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 12.5,
    color: "#33414C",
    padding: "4px 0",
  },
  srcDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: C.trace,
    flexShrink: 0,
  },
  footer: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    background: C.ink,
    color: "#fff",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "12px clamp(16px, 4vw, 48px)",
    zIndex: 20,
  },
  footNote: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 12,
    color: "#B9C4CC",
    lineHeight: 1.4,
    maxWidth: 640,
  },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');

* { -webkit-font-smoothing: antialiased; }

.srcRow { transition: background .18s ease, box-shadow .18s ease; }
.srcRow.lit {
  background: ${C.trace};
  box-shadow: inset 0 0 0 1px rgba(207,231,227,0.4), 0 0 0 3px rgba(47,111,106,0.25);
}
.srcRow.lit .cellK, .srcRow.lit .cellV { color: #EAF5F3 !important; }

.sent {
  cursor: pointer;
  border-radius: 3px;
  padding: 1px 2px;
  transition: background .16s ease, box-shadow .16s ease;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  border-bottom: 2px solid transparent;
}
.sent.unverified { border-bottom-color: ${C.flag}; }
.sent.verified { border-bottom-color: ${C.trace}; }
.sent:hover, .sent.focus {
  background: ${C.traceGlow};
}
.sent:focus-visible {
  outline: 2px solid ${C.trace};
  outline-offset: 2px;
}

.toneBtn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  letter-spacing: 0.03em;
  padding: 7px 12px;
  border: none;
  background: #fff;
  color: #5B6873;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.toneBtn.on { background: ${C.ink}; color: #fff; }

.genBtn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  letter-spacing: 0.03em;
  padding: 8px 14px;
  border: 1px solid ${C.trace};
  background: ${C.trace};
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity .15s;
}
.genBtn:disabled { opacity: 0.55; cursor: default; }

.verifyBtn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.02em;
  padding: 8px 14px;
  border: 1px solid ${C.trace};
  background: #fff;
  color: ${C.trace};
  border-radius: 4px;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.verifyBtn:hover { background: ${C.traceGlow}; }
.verifyBtn.done { background: ${C.trace}; color: #fff; }

.pinClose {
  border: none; background: none; color: ${C.panelDim};
  cursor: pointer; font-size: 13px; padding: 2px 6px;
}
.pinClose:hover { color: ${C.ink}; }

.approveBtn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12.5px;
  letter-spacing: 0.03em;
  padding: 9px 18px;
  border: 1px solid #3A4650;
  background: transparent;
  color: #7E8C97;
  border-radius: 4px;
  cursor: not-allowed;
  white-space: nowrap;
}
.approveBtn.ready {
  background: ${C.trace};
  border-color: ${C.trace};
  color: #fff;
  cursor: pointer;
}

@media (max-width: 760px) {
  .sent { padding: 1px 1px; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;
