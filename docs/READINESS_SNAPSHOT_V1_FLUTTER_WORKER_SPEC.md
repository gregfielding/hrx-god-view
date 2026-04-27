# Worker-facing Flutter spec: `readinessSnapshotV1`

HRX V1 assignment readiness for **workers** in the mobile app. This spec is **read-only**: Flutter loads `readinessSnapshotV1` from Firestore and **must not** call recompute callables or derive readiness from other fields.

**Read path:** `tenants/{tenantId}/assignments/{assignmentId}` → field **`readinessSnapshotV1`** (map).

**Do not use for worker readiness UI:** `assignmentReadinessV1`, server callables, or recomputing the engine on device.

**Companion data (not part of the snapshot contract):** Assignment **title**, **start date**, **job/shift labels** come from the **parent assignment document** (or your existing assignment list API). Only **readiness state, summary, and requirements** come from `readinessSnapshotV1`.

**Product default (mobile):** Show **incomplete requirements only** by default (`missing` / `in_progress`). **Completed** items should be **hidden** or under a **collapsed** “Completed” section so the worker stays focused on what’s left. See [`READINESS_SNAPSHOT_V1_FLUTTER_IMPLEMENTATION_PLAN.md`](./READINESS_SNAPSHOT_V1_FLUTTER_IMPLEMENTATION_PLAN.md) for Flutter structure, loading states, and the **“Next step”** strip.

---

## A. Worker-facing state labels and copy

Map `readinessSnapshotV1.state` to **user-visible headline + short subtitle**. Never show internal enum strings verbatim except in debug builds.

| `state` | Headline (primary) | Subtitle (supportive, optional) |
|---------|-------------------|----------------------------------|
| `READY` | **You’re set** | You’re ready for this assignment. |
| `READY_WITH_WARNINGS` | **Almost there** | A few things still need attention. |
| `BLOCKED` | **A few things left** | Complete the items below to move forward. |
| `PENDING_INITIALIZATION` | **Setting up** | Your checklist for this assignment isn’t ready yet. Check back soon. |

**Copy rules**

- Do **not** use the word **“Blocked”** in worker UI for `BLOCKED` — it sounds punitive. Prefer **“A few things left”** / **“Before you start”** style.
- `READY_WITH_WARNINGS`: avoid **“Warning”** in headline; use **“Almost there”** or **“Action needed”** if product prefers shorter.

---

## B. Worker-facing rendering rules for `requirements[]`

Each row: `key`, `label`, `category`, `status`, `severity`.

### Status (primary for row UI)

| `status` | Worker label | Visual |
|----------|--------------|--------|
| `complete` | **Done** (or hide row in “remaining only” mode) | Positive / check |
| `in_progress` | **In progress** | Neutral / clock or spinner idiom |
| `missing` | **To do** | Neutral outline; not red-by-default unless product wants emphasis |

### Severity (soften `hard_block`)

**Do not** show **“Hard block”**, **“Blocker”**, or **“Required — blocking”** to workers.

Use **severity** only to tune **order** and **gentle emphasis**:

| `severity` | Worker treatment |
|------------|------------------|
| `hard_block` | Treat as **high-priority** in sort order (show first among incomplete). Optional: slightly stronger icon or “Start here” only on the **first** incomplete hard_block row — not on every row. **Row title** still uses `label` from server (e.g. “Work Authorization”) — do not append “(required)”. |
| `warning` | Default priority; normal list weight. |

**`label`:** Use server `label` as default string (e.g. “I-9 Form”, “Background Check”). For certifications (`key` starts with `cert_`), `label` may be long — allow two lines or ellipsis.

**`category`:** Use for **section headers** (optional). Suggested worker-friendly section titles:

| `category` | Section title |
|------------|----------------|
| `identity` | **Your profile** |
| `employment` | **Payroll & forms** |
| `policies` | **Policies** |
| `screening` | **Screening** |
| `certification` | **Certifications** |

**Sorting:** Within a section, incomplete before complete; among incomplete, **`hard_block` before `warning`**; then stable order by original index.

**Do not show:** `sourceVersion`, raw `key` (except analytics/debug), or internal Firestore paths.

---

## C. When `readinessSnapshotV1` is missing

The field may be absent until the first server/UI recompute.

**Assignment list row**

- Show assignment **title/date** from assignment doc as today.
- Readiness chip: **“Checklist loading”** or **“—”** (neutral, not alarming). Optional small grey placeholder.

**Assignment detail**

- **Headline:** **Setting up your checklist**
- **Body:** We’re preparing what you need for this assignment. Pull to refresh in a moment.
- **Requirements list:** Empty state or skeleton — **do not** fabricate rows from other fields.

**Pull-to-refresh:** Reread assignment doc; do not call Cloud Functions to recompute.

---

## D. When `sourceVersion` is unknown

If `sourceVersion` is **not** `1` (or not in the set your app supports):

**Detail / card**

- **Headline:** **Update the app**
- **Body:** This checklist uses a newer format. Update HRX to see your full readiness details.
- **Fallback:** If you still show data, render **headline state** from `state` only (using table in §A) and show **requirements** as a **plain list** without relying on new semantics — or hide requirements entirely if safer.

**Do not** crash; do not block navigation to assignment.

---

## E. Minimal recommended Flutter UI structure

### 1. Assignment list row

**Data**

- **Line 1:** Shift/job title (assignment doc).
- **Line 2:** Date or location (assignment doc, if you already show it).
- **Trailing / chip:** Derived **only** from `readinessSnapshotV1.state` using §A **headline** shortened to one word if needed: e.g. **Set** · **Almost** · **To do** · **Loading** / **Setup**.

**Layout:** One primary column + optional readiness pill on the right; keep tap target full row.

---

### 2. Assignment detail — readiness card

**Single card** above tabs or below header (not full screen unless empty).

**Contents**

1. **Headline + subtitle** from §A (`state` → copy).
2. **Optional one-liner** from `summary`: e.g. “**3** items to complete” when `warnings + blockers` incomplete count > 0 (derive from `requirements` if you prefer exact count of `status != complete`).
3. **Primary CTA (optional):** Scroll to first incomplete requirement or open deep link if you have one per `key` (out of scope here — no new backend).

**Do not** show `summary.blockers` / `summary.warnings` as scary numbers without context; prefer **“X items left”** total incomplete.

---

### 3. Requirement list

**Structure**

- Optional **section list** by `category` (§B titles).
- Each **row:**  
  - Leading: status icon (`complete` / `in_progress` / `missing`).  
  - **Title:** `label`.  
  - No **severity** text; optional **“Start here”** badge on first incomplete `hard_block` only.

**Empty:** Only when `requirements` is empty (e.g. `PENDING_INITIALIZATION` or empty array). Use copy from §C.

**Spacing:** Comfortable touch targets; avoid dense tables.

---

## Quick reference checklist (Flutter)

- [ ] Read **`readinessSnapshotV1` only** for readiness state and requirement rows.
- [ ] **Never** show “Blocked” / “Hard block” for worker copy.
- [ ] **Missing snapshot** → supportive “setting up” / loading chip on list; empty or skeleton on detail.
- [ ] **Unknown `sourceVersion`** → prompt app update + safe fallback.
- [ ] **Assignment title** still from **assignment document**, not snapshot.

---

*Canonical field shape and operator/trigger behavior: `docs/READINESS_SNAPSHOT_V1.md`.*
