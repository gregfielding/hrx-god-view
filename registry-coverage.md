# Registry Coverage — Job Orders (Phase 2)

This living doc tracks which Job Order fields are **sourced from the Field Registry** (labels/options/validation) and which still rely on legacy hardcoding.

_Last updated: 2025-09-25_

## ✅ Migrated (registry-driven)

| Field ID        | Type     | Source in UI | Mapping to Firestore | Notes |
|-----------------|----------|--------------|----------------------|-------|
| `jobTitle`      | text     | `useFieldDef('jobTitle')` | flat `jobOrders.jobTitle` | Label from registry |
| `experienceLevel` | select (`entry|intermediate|advanced`) | `useFieldDef('experienceLevel')` | flat `jobOrders.experienceLevel` | Options from registry; coercion in mapping |
| `notes`         | textarea | `useFieldDef('notes')` | flat `jobOrders.notes` | Label from registry |
| `payRate`       | currency/number | `useFieldDef('payRate')` | flat `jobOrders.payRate` | `toNumberSafe` in mapping |
| `startDate`     | date     | `useFieldDef('startDate')` | flat `jobOrders.startDate` | `toISODate` in mapping |
| `workersNeeded` | number   | `useFieldDef('workersNeeded')` | flat `jobOrders.workersNeeded` | `toNumberSafe` in mapping |
| `estimatedRevenue` | number | `useFieldDef('estimatedRevenue')` | flat `jobOrders.estimatedRevenue` | `toNumberSafe` in mapping |
| `companyId`     | text     | **labels only** from registry | flat `jobOrders.companyId` | UI label centralized; value unchanged |
| `companyName`   | text     | **labels only** from registry | flat `jobOrders.companyName` | UI label centralized; value unchanged |
| `worksiteId`    | text     | **labels only** from registry | flat `jobOrders.worksiteId` | UI label centralized; value unchanged |
| `worksiteName`  | text     | **labels only** from registry | flat `jobOrders.worksiteName` | UI label centralized; value unchanged |
| `priority`      | select (`low|medium|high`) | `useFieldDef('priority')` | flat `jobOrders.priority` | options + coercion default `'low'` |
| `shiftType`     | select (`day|swing|night`) | `useFieldDef('shiftType')` | flat `jobOrders.shiftType` | options + coercion default `'day'` |

## ⏳ Remaining (to migrate)

> Add here as you discover fields still using hardcoded labels/options. Aim to migrate in **small batches**.

- (none pending) — _update as needed_

## 🔒 Parity Policy (CI)

- **Blocking** (target date: **TBD**):
  - Unknown `fieldId` in forms
  - `type: 'select'` with empty/missing `options`
  - `usedBy: ['Both']` missing from either form list
- **Advisory**: All other warnings

Flip to blocking after 3–5 days of clean runs on `main`.

## 🧪 Test Commands

```bash
npm run check:parity
npm run test:mapping
```

## 🚦 Change Management

- New/changed fields must be added to `src/fields/registry.ts` with correct `type`, `options` (if select), and `usedBy` flags.
- UI must source labels/options via `useFieldDef(fieldId)`.
- Mapping must handle coercions deterministically (`toNumberSafe`, `toISODate`, `coerceSelect`).
