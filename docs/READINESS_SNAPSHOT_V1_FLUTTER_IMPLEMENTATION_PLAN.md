# Flutter UI implementation plan: worker `readinessSnapshotV1`

This document turns the approved **worker spec** into an actionable Flutter implementation plan. **Copy, state labels, severity softening, and missing/unknown-version behavior** remain as defined in [`READINESS_SNAPSHOT_V1_FLUTTER_WORKER_SPEC.md`](./READINESS_SNAPSHOT_V1_FLUTTER_WORKER_SPEC.md).

**Hard constraints (unchanged)**

- Read **`readinessSnapshotV1` only** for readiness (state, summary, requirements). Assignment chrome from the **assignment document**.
- **Do not** recompute readiness in Flutter; **do not** add backend fields for this step.

**Product default (list focus)**

- **Default the requirement list to incomplete items only** (`status` is `missing` or `in_progress`). **Completed** (`status == complete`) rows are **hidden by default** or behind a **collapsed** “Completed” disclosure (single tap to expand). Keeps mobile focused on what the worker still needs to do.

---

## A. Assignment list row — implementation spec

### Data sources

| UI element | Source |
|------------|--------|
| Primary title, subtitle (date/location) | Assignment document (existing streams/models). |
| Readiness pill / chip text | `readinessSnapshotV1.state` only — map via worker spec §A; shorten for chip (see below). |
| Chip visibility when snapshot missing | Treat as **loading** state (see §E). |

### State → chip label (short)

Use a **fixed short string** for the trailing chip to avoid truncation:

| `state` | Chip text |
|---------|-----------|
| `READY` | Set |
| `READY_WITH_WARNINGS` | Almost |
| `BLOCKED` | To do |
| `PENDING_INITIALIZATION` | Setup |
| *(field missing)* | … or “Loading” (see §E) |

### Layout

- **Row:** `InkWell` / `ListTile`-style; full-row tap navigates to assignment detail.
- **Leading (optional):** Existing assignment avatar/icon if you already use one.
- **Title:** Assignment title, `maxLines: 2`, ellipsis.
- **Subtitle:** Existing meta (date, site) — unchanged.
- **Trailing:** `readinessSnapshotV1` chip — `Chip` or `DecoratedBox` with subtle background; **no** red for `BLOCKED` (neutral or brand secondary).

### ViewModel / parsing

- Parse snapshot once per assignment doc read into an immutable `ReadinessSnapshotV1?` (null = missing).
- **Do not** merge `assignmentReadinessV1` into this row.

---

## B. Assignment detail — readiness card — implementation spec

### Placement

- One **card** (e.g. `Card` + `Padding`) immediately **below** the assignment header / **above** shift details or tabs — consistent anchor so workers always find checklist context.

### Card contents (top → bottom)

1. **Headline + subtitle** from worker spec §A (`state`).
2. **Optional count line:** If any incomplete requirements exist, show **“N items left”** where `N` = count of rows with `status != complete` in `requirements` (client-side **filter/count only**, not readiness recompute).
3. **§F — “Next step” strip** (recommended when incomplete count ≥ 1): see section F.
4. **Requirement list** (§C, §D): own scroll is **not** required inside card; prefer **single scroll parent** for the screen with card + list as slivers.

### When `state == READY` and incomplete count is 0

- Show headline **You’re set** and short subtitle; **omit** count line and §F strip; requirement area shows **empty incomplete list** — optional one line: “Nothing else needed here.” or hide the list block entirely.

### Analytics

- Optional: log `readinessSnapshotV1.state` and `sourceVersion` on screen view (debug/analytics only; not shown in UI).

---

## C. Requirement row — rendering rules

### Row model (from snapshot)

For each item in `requirements` (preserve server order for tie-break; **display order** = spec sort: section by `category`, then incomplete before complete within section, then `hard_block` before `warning` among incomplete).

### Widget structure (per row)

- **Leading:** Icon by `status`:
  - `complete` — check / filled success (shown only when row visible — see §D).
  - `in_progress` — clock or progress icon, neutral color.
  - `missing` — empty circle or neutral dash, **not** error red by default.
- **Title:** `Text(requirement.label)`, `maxLines: 2`, ellipsis.
- **Trailing (optional):** `Chevron` if row navigates somewhere; omit if row is display-only until deep links exist.
- **Badge:** **“Start here”** on **at most one** row globally — the **first** incomplete requirement with `severity == hard_block` after sort. Never show severity strings in copy.

### Interaction

- **Tap:** If product has navigation by `key`, use `key` in a switch/map to routes; else no-op or show a generic “Complete this in HRX on the web” only if product approves — **no new backend** for routing in this step.

### Accessibility

- Row `semanticsLabel`: combine status worker label (Done / In progress / To do) + `label`.

---

## D. Incomplete-only default behavior

### Default mode: **incomplete only**

- **Filter:** Show rows where `status == missing` || `status == in_progress`.
- **Sort:** Apply worker spec §B sort on the **full** list, then **filter** — so order among visible rows matches priority (hard_block first, etc.).

### Completed items

Choose **one** pattern (product can A/B later):

1. **Hidden + disclosure (recommended):** Footer button or `ExpansionTile` titled **“Completed (N)”** with `initiallyExpanded: false`. Inside: same row widget as §C but typically **dimmer** title and check icon; no “Start here”.
2. **Hidden + link:** Text button **“Show completed”** toggles a `bool` and inserts completed rows below incomplete sections.

### Edge cases

- **All complete:** Incomplete list empty — show a single supportive line under the card (“You’re all set for this checklist.”) or rely on card READY copy only.
- **Empty `requirements` array:** Use loading / missing snapshot behavior (§E), not “completed” disclosure.

### State holder

- `showCompletedRequirements: bool` default **`false`**; persist in memory only (no need to persist across sessions unless PM asks).

---

## E. Loading / missing / unknown-version states

Implement a small **readiness UI state enum** derived only from snapshot + assignment read:

| Derived state | Condition | List row chip | Detail card |
|---------------|-----------|---------------|-------------|
| **Loading** | Assignment doc not yet loaded, or snapshot field absent and you treat first paint as loading | “Loading” or neutral skeleton chip | Skeleton lines in card **or** copy from worker spec §C “Setting up your checklist” |
| **Missing snapshot** | Doc loaded, `readinessSnapshotV1 == null` | “Checklist loading” or “—” | Worker spec §C headline + body; empty/skeleton list; pull-to-refresh re-fetch only |
| **Known version** | `sourceVersion == 1` (or in app allowlist) | Normal chip from `state` | Full card + requirements |
| **Unknown version** | `sourceVersion` not in allowlist | **“Update”** or still show short chip from `state` if safe | Worker spec §D: **Update the app** + body; requirements hidden or plain list fallback |

**Rules**

- **Never** block back navigation or assignment access.
- **Pull-to-refresh:** Refetch assignment document only; **do not** invoke recompute callables.
- Transitions: `Loading` → `Missing` → `Known` should not flash error styling.

---

## F. Top “Next steps” section for workers

### Recommendation: **Yes — one compact “Next step” block, not a second checklist**

Workers benefit from a **single, scannable answer** to “what should I do first?” without reading grouped sections. The incomplete-only list already lists work; a **duplicate long list** at the top would add noise.

**Show when**

- `readinessSnapshotV1` is present and **known version**, and  
- `state != READY` **or** incomplete count ≥ 1, and  
- At least one incomplete requirement exists after sort.

**Content**

- **Section title:** **What to do next** (or **Next step** if only one incomplete item).
- **Body:** **One** primary line: label of the **first** incomplete requirement after §B sort (same row as would get “Start here” if it is `hard_block`).
- **Optional second line:** If a **second** incomplete item exists, show as secondary text or sublabel (smaller style) — **max two** items in this strip. Do not list three or more; the requirement list handles the rest.

**Interaction**

- Tapping the strip scrolls to the **first** incomplete row’s `GlobalKey` / `Scrollable.ensureVisible`, or fires the same `onTap` as that requirement row.

**Hide when**

- `READY` with zero incomplete items, **or** missing/unknown-version handling takes over, **or** zero incomplete requirements.

**Relationship to “Start here”**

- Either **strip OR badge** on first row — avoid both repeating the same string. **Preferred:** strip carries “what’s next”; row uses icon + label only, **or** keep **“Start here”** on the row and use a neutral strip title **“Continue with”** + label. Pick one pattern app-wide.

---

## Implementation order (suggested)

1. **Models:** `ReadinessSnapshotV1` from JSON/map; `sourceVersion` allowlist constant (`{1}`).
2. **Derived state:** §E enum from snapshot + doc load.
3. **List row:** §A chip + assignment chrome.
4. **Detail card:** §B + §F strip + §E branches.
5. **Requirement list:** §C sort/filter; §D incomplete default + completed disclosure.
6. **Polish:** A11y, loading skeletons, analytics hooks.

---

## Checklist

- [ ] Readiness data **only** from `readinessSnapshotV1`.
- [ ] Default list = **incomplete only**; completed **hidden or collapsed**.
- [ ] No readiness **recompute**; no new **backend** fields.
- [ ] Missing / unknown-version paths from §E and worker spec.
- [ ] **Next step** strip per §F (or documented product exception).

---

*Worker copy and field semantics: [`READINESS_SNAPSHOT_V1_FLUTTER_WORKER_SPEC.md`](./READINESS_SNAPSHOT_V1_FLUTTER_WORKER_SPEC.md). Operator contract: [`READINESS_SNAPSHOT_V1.md`](./READINESS_SNAPSHOT_V1.md).*
