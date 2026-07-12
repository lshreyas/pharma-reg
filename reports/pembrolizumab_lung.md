# Consistency report — `pembrolizumab_lung`

**Sources analyzed:** 2

- `clinicaltrials__NCT02578680` — KEYNOTE-189 (NCT02578680) — ClinicalTrials.gov record · global · v.2024-09-20
- `openfda_label__KEYTRUDA` — KEYTRUDA US Prescribing Information (openFDA) · US · v.20260624

**Flags:** 2 total — 2 numeric mismatch, 0 missing-fact

## Numeric mismatches

### 1. `Trial` / `KEYNOTE-189` · `enrollment`

Numeric values differ across sources: '616' (KEYNOTE-189 (NCT02578680) — ClinicalTrials.gov record), '607' (KEYTRUDA US Prescribing Information (openFDA))

  - **KEYNOTE-189 (NCT02578680) — ClinicalTrials.gov record** · `protocolSection.designModule` · value=`616` patients · confidence=0.99
    > "count": 616, "type": "ACTUAL"
  - **KEYTRUDA US Prescribing Information (openFDA)** · `adverse_reactions` · value=`607` patients · confidence=0.98
    > A total of 607 patients received KEYTRUDA 200 mg, pemetrexed and platinum every 3 weeks for 4 cycles

### 2. `Trial` / `KEYNOTE-189` · `population`

Numeric values differ across sources: 'ECOG Performance Status 0 or 1' (KEYNOTE-189 (NCT02578680) — ClinicalTrials.gov record), 'median age 64 years (range 34-84), 49% age 65+, 59% male, 94% White, 3% Asian, 56% ECOG PS 1, 18% brain metastases history' (KEYTRUDA US Prescribing Information (openFDA))

  - **KEYNOTE-189 (NCT02578680) — ClinicalTrials.gov record** · `protocolSection.eligibilityModule` · value=`ECOG Performance Status 0 or 1` · confidence=0.99
    > Has a performance status of 0 or 1 on the Eastern Cooperative Oncology Group (ECOG) Performance Status.
  - **KEYTRUDA US Prescribing Information (openFDA)** · `clinical_studies` · value=`median age 64 years (range 34-84), 49% age 65+, 59% male, 94% White, 3% Asian, 56% ECOG PS 1, 18% brain metastases history` · confidence=0.97
    > median age of 64 years (range: 34 to 84), 49% age 65 or older; 59% male; 94% White and 3% Asian; 56% ECOG PS of 1; and 18% with history of brain metastases
