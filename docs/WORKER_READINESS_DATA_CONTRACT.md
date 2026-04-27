# Worker Readiness Data Contract (Phase: Scoring Structure)

## Scope
- Defines the UI/Firestore contract for Home readiness summary + checklist ordering.
- No trigger scheduling, AI nudges, or backend migration in this phase.

## Proposed Firestore Path
- `users/{uid}.workerProfile.readiness.homeSnapshot`

## Snapshot Shape (v1)
```ts
{
  version: 1,
  updatedAt: Timestamp,
  scoring: {
    readinessPercent: number,      // 0..100
    completedCount: number,        // completed required/high_impact items
    requiredCount: number,         // required + high_impact count
    totalWeight: number,           // weighted denominator
    completedWeight: number,       // weighted numerator
    industryContext: ("hospitality" | "industrial")[]
  },
  checklist: [
    {
      id: string,                  // "profile_photo", "work_authorization", ...
      title: string,
      benefit: string,
      priority: "required" | "high_impact" | "optional",
      status: "missing" | "in_progress" | "complete" | "recommended",
      launchStep: string,          // Home -> wizard launch target
      weight: number,              // scoring impact
      industries: ("hospitality" | "industrial")[],
      relevanceScore: number,      // 0..1 by selected target industries
      sortOrder: number,
      completedAt?: Timestamp
    }
  ],
  orderedNextStepIds: string[]
}
```

## Weighted Scoring Model
- `readinessPercent = round((completedWeight / totalWeight) * 100)`
- `effectiveItemWeight = weight * relevanceScore`
- `completedWeight` only counts checklist items with `status = complete`
- Optional items still contribute (low weight) but do not inflate required count.

## Priority and Status Model
- **Priority**
  - `required`
  - `high_impact`
  - `optional`
- **Status**
  - `missing`
  - `in_progress`
  - `complete`
  - `recommended`

## Industry-Aware Relevance
- Each item declares `industries` it supports.
- `relevanceScore` is derived from overlap between item industries and worker target industries.
- Allows hospitality/industrial weighting differences without changing UI contract.

## Home Consumption Contract
- Home consumes:
  - summary (`readinessPercent`, `completedCount`, `requiredCount`)
  - ordered checklist
  - `orderedNextStepIds` for dynamic CTA (`Next: [label]`)
  - `launchStep` per item

## Fallback Behavior
- If `homeSnapshot` is missing, frontend computes deterministic model from current `userDoc`.
- Same interface is returned to Home (`source: snapshot | computed`).

## Trigger Phase Recommendation
1. Add backend writer to maintain `homeSnapshot` on worker profile updates.
2. Recompute snapshot when key readiness domains change:
   - profile photo
   - work eligibility attestation
   - availability/preferences
   - certifications
   - skills/experience
   - resume metadata
3. Keep deterministic item IDs and versioned weight tables.
4. Preserve UI fallback compute path until snapshot coverage is stable.
