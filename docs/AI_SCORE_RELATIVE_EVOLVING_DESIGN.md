# AI Score: Relative & Evolving Over Time

**Goal:** Make the AI score reflect how a user compares to the current pool, so the bar moves as more users join and as the population becomes more complete/responsive. The score should self-adjust as more data enters the system.

---

## 1) Current behavior (absolute score)

- **Raw components** (0–100 each): `completenessScore`, `responsivenessScore`, `qualityScore`.
- **Formula:** `aiScore = 0.45×C + 0.25×R + 0.3×Q` (stored 0–100).
- **Issue:** A “good” user today might look average later when many stronger profiles exist; early users can have inflated scores relative to a growing, higher-quality pool.

---

## 2) Desired behavior (relative + evolving)

- **Relative:** Score reflects position vs. other users (e.g. median user ≈ 50, top decile ≈ 90).
- **Evolving:** As the pool grows and improves, the distribution is recomputed periodically; the same raw inputs can yield a different relative score over time.
- **Self-adjusting:** No manual recalibration; a scheduled job (and optional on-write triggers) keeps the distribution and, if used, relative scores in sync.

---

## 3) Architecture options

### Option A: Percentile at read time (recommended for MVP)

- **Keep:** Per-user `scoreSummary`: `completenessScore`, `responsivenessScore`, `qualityScore`, `aiScore` (raw).
- **Add:** A **score distribution** document per tenant (or global), updated periodically:
  - Path: `tenants/{tenantId}/scoringDistribution` (or `config/scoringDistribution` if global).
  - Content: Percentiles (or min/p25/p50/p75/p90/max) for:
    - `completenessScore`
    - `responsivenessScore`
    - `qualityScore`
    - `aiScore` (raw combined score)
  - Example:
    ```ts
    {
      updatedAt: Timestamp,
      userCount: number,
      aiScore: { p10: number, p25: number, p50: number, p75: number, p90: number },
      completenessScore: { p50: number, p90: number },
      responsivenessScore: { p50: number, p90: number },
      qualityScore: { p50: number, p90: number }
    }
    ```
- **Display:** When showing a user’s AI score:
  1. Read user’s raw `aiScore` (and optionally components).
  2. Read tenant’s `scoringDistribution`.
  3. Compute percentile rank of user’s raw `aiScore` vs. distribution (e.g. linear interpolation between p25/p50/p75/p90).
  4. Map percentile (0–1) to display score 0–100, e.g. `displayScore = percentile * 100`, so median ≈ 50, top 10% ≈ 90.
- **Pros:** No need to rewrite every user when distribution changes; single source of truth (raw scores); distribution doc is small and cacheable.
- **Cons:** Every score display needs distribution (can be cached in context or in-memory for the session).

### Option B: Stored relative score (batch-updated)

- **Keep:** Raw components and raw `aiScore` on each user.
- **Add:** `aiScoreRelative` (0–100) on each user, e.g. “score relative to pool”.
- **Process:** Scheduled job (e.g. nightly):
  1. Query all users in tenant; collect raw `aiScore` (and components if needed).
  2. Compute distribution (percentiles).
  3. For each user, compute percentile rank of their raw `aiScore`, map to 0–100, write `aiScoreRelative` (and optionally `aiScoreRelativeUpdatedAt`).
- **Display:** Use `aiScoreRelative` in tables and profile.
- **Pros:** Simple reads; no distribution fetch at display time.
- **Cons:** Batch must touch every user when distribution changes; slight delay before “bar moves” (e.g. daily).

### Option C: Hybrid (relative in UI, optional stored percentile)

- Store distribution as in Option A.
- Compute relative score at read time for lists and profile (Option A).
- Optionally run a lighter batch that only writes `aiScorePercentile` (0–100) to each user for sorting/filtering in Firestore (e.g. “top 20%”) without full table scans in the client.

---

## 4) Recommended approach: Option A + scheduled distribution job

1. **Data model**
   - **Users:** Keep existing `scoreSummary` (raw components + raw `aiScore`). No new required fields.
   - **Tenant (or config):** Add `scoringDistribution` doc with percentiles and `userCount`, `updatedAt`.

2. **Distribution computation (scheduled)**
   - **Frequency:** Daily (or after N new/updated users).
   - **Logic:**
     - Query users that have `scoreSummary.aiScore` (or have any of the three components).
     - Collect `completenessScore`, `responsivenessScore`, `qualityScore`, `aiScore` (use defaults for missing components when computing raw aiScore for distribution only).
     - Compute percentiles (e.g. p10, p25, p50, p75, p90) for each metric and for raw `aiScore`.
     - Write to `tenants/{tenantId}/scoringDistribution` with `updatedAt` and `userCount`.
   - **Scale:** If user count is very large, use sampling or Firestore aggregation queries if available; otherwise a single batch read per tenant is acceptable for nightly run.

3. **Relative score at read time**
   - **Helper:** `getRelativeAiScore(rawAiScore: number, distribution: ScoringDistribution): number`
     - If no distribution or `userCount` too small (e.g. < 10), return raw score (or “N/A”).
     - Compute percentile rank of `rawAiScore` vs. `distribution.aiScore` (e.g. linear interpolation between p25/p50/p75/p90).
     - Return `Math.round(percentile * 100)` so 0–100 scale where 50 ≈ median.
   - **UI:** Where we currently show `scoreSummary.aiScore`, optionally:
     - Show relative score as main pill (so “50” = median).
     - Tooltip or secondary line: “Raw: 62 · vs. pool: 50 (median)” or “Top 30%”.

4. **Self-adjustment**
   - As more users are added and completeness/responsiveness/quality improve across the pool, the distribution shifts (e.g. p50 goes up). The same raw score then yields a lower percentile, so the displayed relative score drops. No manual bar movement; the nightly (or periodic) job keeps the distribution current.

5. **Edge cases**
   - **New tenant / few users:** If `userCount < 10` (or similar), skip relative mapping and show raw score, or show “Insufficient data for comparison.”
   - **Missing distribution:** Fall back to raw `aiScore` everywhere.
   - **Stale distribution:** Use `updatedAt`; if older than 7 days, consider showing raw or a “Distribution may be outdated” note until next run.

---

## 5) Implementation checklist

- [ ] Add Firestore type and path for `scoringDistribution` (e.g. `tenants/{tenantId}/scoringDistribution`).
- [ ] Implement Cloud Function (or scheduled job) that computes percentiles from all users in a tenant and writes `scoringDistribution`.
- [ ] Add client (or server) helper: `getRelativeAiScore(rawAiScore, distribution)` with fallback when distribution missing or thin.
- [ ] Fetch or cache `scoringDistribution` where scores are displayed (users table, profile header, Score tab). Prefer one fetch per tenant per session (e.g. React context or existing tenant config).
- [ ] Update UI to show relative score (and optionally raw in tooltip). Ensure tables sort by relative score if that’s the primary meaning.
- [ ] Document in spec that `aiScore` remains the raw formula output; “relative” is a display layer on top.

---

## 6) Optional: per-component relative view

- Same distribution can expose percentiles for `completenessScore`, `responsivenessScore`, `qualityScore`.
- Score tab could show: “Completeness: 70 (raw) · Top 40%” so the bar moving is visible per dimension.
- Implementation: same distribution doc; helper per component; optional in UI.
