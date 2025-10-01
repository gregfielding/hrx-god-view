# 📘 Field Registry & Form Parity — Implementation Guide for Cursor

**Audience:** Cursor (your AI coding partner)  
**Goal:** Eliminate field drift between **Deals** and **Job Orders** by introducing a **single source of truth (SSOT)** for fields, wired into UI forms, Firestore documents, mapping logic, CI checks, and migrations.

---

## Why We’re Doing This

1. **Consistency:** Deals and Job Orders must share the same field **keys**, **types**, and (where applicable) **options**.
2. **Safety:** Changes like **text → select** should be done once in a registry and applied everywhere with guardrails (validation, migrations).
3. **Speed:** Form rendering and data mapping should be **declarative**, not repeated across components.
4. **Traceability:** Job Orders should store an **immutable snapshot** of “as-won” values plus a **working** area that recruiters update.
5. **Quality Gate:** A **CI parity check** blocks merges if Deal/JobOrder forms drift from the registry.

---

## Deliverables (Cursor – create all)

**Files (new):**
```
src/fields/FieldTypes.ts
src/fields/validators.ts
src/fields/registry.ts
src/forms/DealForm.ts
src/forms/JobOrderForm.ts
src/mappings/dealToJobOrder.ts
src/services/jobOrder/generateFromDeal.ts
src/services/jobOrder/save.ts
scripts/checkFieldParity.ts
scripts/migrateFields.ts
scripts/printFieldDocs.ts
```

**Integrations to implement:**
- Form renderers consume registry by `fieldId` (no hardcoded types/options).
- Firestore write shapes include `schemaVersion`, `initialSnapshot`, `working`.
- A parity script runs in CI (fails on mismatch).
- A migration script updates legacy docs when `SCHEMA_VERSION` bumps.

---

## 1) Types & Validators

**`src/fields/FieldTypes.ts`**
```ts
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'object'
  | 'array';

export type Option = { value: string; label: string; disabled?: boolean };

export type FieldDef = {
  id: string;                  // canonical key, e.g. "startDate"
  label: string;               // UI label
  type: FieldType;
  required?: boolean;
  description?: string;

  // Select/multiselect
  options?: Option[];

  // Object/array shapes (lightweight hints for UI & checks)
  itemShape?: Record<string, FieldType> | FieldType;

  // Validation (string name referencing a zod schema or inline guards)
  validator?: string;

  // Where it is used (for parity checks & docs)
  usedBy: Array<'Deal'|'JobOrder'|'Both'>;

  // Defaults and metadata
  defaultValue?: any;
  tags?: string[];
  deprecated?: boolean;
};

export type Registry = Record<string, FieldDef>;
```

**`src/fields/validators.ts`**
```ts
import { z } from 'zod';

export const AddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  zip: z.string().min(5),
});

export const CurrencySchema = z.number().nonnegative();

export const SelectExperienceSchema = z.enum(['entry', 'intermediate', 'advanced']);
```

---

## 2) The Field Registry (SSOT)

**`src/fields/registry.ts`**
```ts
import type { Registry } from './FieldTypes';

export const SCHEMA_VERSION = 1; // bump on breaking changes

export const FieldRegistry: Registry = {
  roleTitle: {
    id: 'roleTitle',
    label: 'Role Title',
    type: 'text',
    usedBy: ['Both'],
  },
  startDate: {
    id: 'startDate',
    label: 'Start Date',
    type: 'date',
    required: true,
    validator: 'z.date()',
    usedBy: ['Both'],
    tags: ['scheduling','start'],
  },
  shiftLengthHours: {
    id: 'shiftLengthHours',
    label: 'Shift Length (hours)',
    type: 'number',
    validator: 'z.number().positive()',
    usedBy: ['Both'],
    defaultValue: 8,
  },
  jobSiteAddress: {
    id: 'jobSiteAddress',
    label: 'Job Site Address',
    type: 'object',
    itemShape: { street: 'text', city: 'text', state: 'text', zip: 'text' },
    validator: 'AddressSchema',
    usedBy: ['Both'],
  },
  payRate: {
    id: 'payRate',
    label: 'Pay Rate',
    type: 'currency',
    validator: 'CurrencySchema',
    usedBy: ['Both'],
    tags: ['comp'],
  },
  experienceLevel: {
    id: 'experienceLevel',
    label: 'Experience Level',
    type: 'select',
    options: [
      { value: 'entry', label: 'Entry' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
    ],
    validator: 'SelectExperienceSchema',
    usedBy: ['Both'],
  },
  // Deal-only
  customerPO: {
    id: 'customerPO',
    label: 'Customer PO #',
    type: 'text',
    usedBy: ['Deal'],
  },
  // JobOrder-only
  recruiterNotes: {
    id: 'recruiterNotes',
    label: 'Recruiter Notes',
    type: 'textarea',
    usedBy: ['JobOrder'],
  },
};
```

> **Change Policy:** Any field type/options change happens **here**. The forms and mapping layer must **not** hardcode types/options.

---

## 3) Form Definitions (Compose by Field IDs)

**`src/forms/DealForm.ts`**
```ts
export const DealFormFieldIds = [
  'roleTitle',
  'startDate',
  'shiftLengthHours',
  'jobSiteAddress',
  'payRate',
  'experienceLevel',
  'customerPO',
] as const;
```

**`src/forms/JobOrderForm.ts`**
```ts
export const JobOrderFormFieldIds = [
  'roleTitle',
  'startDate',
  'shiftLengthHours',
  'jobSiteAddress',
  'payRate',
  'experienceLevel',
  'recruiterNotes',
] as const;

// Optional per-form overrides (e.g., required/hidden/default)
export const JobOrderOverrides: Partial<Record<string, { required?: boolean; hidden?: boolean; defaultValue?: any }>> = {
  recruiterNotes: { required: false },
};
```

**Renderer contract (existing UI should follow this):**
- Given a `fieldId`, the form renderer pulls:
  - `type`, `label`, `options`, `validator`, `required` from `FieldRegistry[fieldId]`
  - Apply per-form overrides if present
- No options or types are defined inside the component.

---

## 4) Mapping Deal → Job Order

**`src/mappings/dealToJobOrder.ts`**
```ts
type MappingRule = {
  copy?: boolean;             // default true
  snapshot?: boolean;         // include in initialSnapshot
  track?: boolean;            // include in working (editable)
  transform?: (value: any, deal: any) => any; // optional
};

const defaultRule: MappingRule = { copy: true, snapshot: true, track: true };

export const DealToJobOrderMap: Record<string, MappingRule> = {
  roleTitle: { ...defaultRule },
  startDate: { ...defaultRule },
  shiftLengthHours: { ...defaultRule },
  jobSiteAddress: { ...defaultRule },
  payRate: { ...defaultRule },
  experienceLevel: { ...defaultRule },

  // Deal-only: don't copy
  customerPO: { copy: false },

  // JobOrder-only with init value
  recruiterNotes: {
    copy: true,
    snapshot: false,
    track: true,
    transform: (_v, deal) => `Created from Deal ${deal.id} on ${new Date().toISOString()}`,
  },
};
```

**`src/services/jobOrder/generateFromDeal.ts`**
```ts
import { DealToJobOrderMap } from '../../mappings/dealToJobOrder';
import { SCHEMA_VERSION } from '../../fields/registry';

export function generateJobOrderFromDeal(deal: any) {
  const initialSnapshot: Record<string, any> = {};
  const working: Record<string, any> = {};

  for (const [fieldId, rule] of Object.entries(DealToJobOrderMap)) {
    const r = { copy: true, snapshot: true, track: true, ...rule };
    if (!r.copy) continue;

    const raw = deal[fieldId];
    const value = r.transform ? r.transform(raw, deal) : raw;

    if (r.snapshot) initialSnapshot[fieldId] = value;
    if (r.track) working[fieldId] = value;
  }

  return {
    sourceDealId: deal.id,
    schemaVersion: SCHEMA_VERSION,
    initialSnapshot,
    working,
    status: 'Open',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
```

**`src/services/jobOrder/save.ts`** (example Firestore write)
```ts
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { generateJobOrderFromDeal } from './generateFromDeal';

export async function createJobOrderFromDeal(deal: any) {
  const jobOrder = generateJobOrderFromDeal(deal);
  const ref = doc(db, 'jobOrders', crypto.randomUUID());
  await setDoc(ref, {
    ...jobOrder,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id };
}
```

**Firestore Document Shape (Job Order)**
```txt
/jobOrders/{jobOrderId}
  sourceDealId: string
  schemaVersion: number
  initialSnapshot: { [fieldId]: any }  // immutable “as-won”
  working: { [fieldId]: any }          // recruiter edits
  status: 'Open'|'On Hold'|'Filled'|'Cancelled'
  createdAt: Timestamp
  updatedAt: Timestamp
```

> **UI:** Show **As-Won Details** (read-only from `initialSnapshot`) and **Working Fields** (editable from `working`).

---

## 5) Parity Check (CI Gate)

**`scripts/checkFieldParity.ts`**
```ts
import { FieldRegistry } from '../src/fields/registry';
import { DealFormFieldIds } from '../src/forms/DealForm';
import { JobOrderFormFieldIds } from '../src/forms/JobOrderForm';

function mustGet(id: string) {
  const def = FieldRegistry[id];
  if (!def) throw new Error(`Field ${id} not found in FieldRegistry`);
  return def;
}

(function main() {
  const issues: string[] = [];

  // Ensure form field IDs exist in registry
  [...DealFormFieldIds, ...JobOrderFormFieldIds].forEach(mustGet);

  // Fields intended for both forms must appear in both lists
  const both = Object.values(FieldRegistry).filter(f => f.usedBy.includes('Both')).map(f => f.id);

  for (const id of both) {
    const inDeal = (DealFormFieldIds as readonly string[]).includes(id);
    const inJO   = (JobOrderFormFieldIds as readonly string[]).includes(id);
    if (!inDeal || !inJO) {
      issues.push(`Field ${id} is usedBy Both but missing in ${!inDeal ? 'Deal' : ''}${!inDeal && !inJO ? ' and ' : ''}${!inJO ? 'JobOrder' : ''}`);
    }
  }

  // Optional: check forbidden fields (e.g., Deal-only inside JobOrder form)
  for (const id of JobOrderFormFieldIds as readonly string[]) {
    const def = mustGet(id);
    const isDealOnly = def.usedBy.includes('Deal') && !def.usedBy.includes('JobOrder') && !def.usedBy.includes('Both');
    if (isDealOnly) {
      issues.push(`JobOrder form includes Deal-only field: ${id}`);
    }
  }

  if (issues.length) {
    console.error('❌ Field parity check failed:\n' + issues.map(i => ' - ' + i).join('\n'));
    process.exit(1);
  } else {
    console.log('✅ Field parity check passed');
  }
})();
```

**CI Configuration (example)**
```json
{
  "scripts": {
    "check:parity": "ts-node scripts/checkFieldParity.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```
> Add the parity script to your PR pipeline. **Block merges** when it fails.

---

## 6) Migrations (when `SCHEMA_VERSION` changes)

**When to bump:** breaking changes (type change, option changes that invalidate data, removals).

**`scripts/migrateFields.ts`**
```ts
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { SCHEMA_VERSION } from '../src/fields/registry';

const app = initializeApp({ /* your config */ });
const db = getFirestore(app);

async function migrateFrom(version: number, jo: any): Promise<any> {
  // Example: text → select coercion for experienceLevel
  if (version < 1) {
    const v = jo.working?.experienceLevel ?? jo.initialSnapshot?.experienceLevel;
    const norm = typeof v === 'string' ? v.toLowerCase() : v;
    const valid = ['entry','intermediate','advanced'];
    const coerced = valid.includes(norm) ? norm : 'entry';
    if (jo.working) jo.working.experienceLevel = coerced;
    if (jo.initialSnapshot && jo.initialSnapshot.experienceLevel === undefined) {
      jo.initialSnapshot.experienceLevel = coerced;
    }
  }
  return jo;
}

async function run() {
  const snap = await getDocs(collection(db, 'jobOrders'));
  for (const d of snap.docs) {
    const jo = d.data();
    const current = jo.schemaVersion ?? 0;
    if (current >= SCHEMA_VERSION) continue;

    const migrated = await migrateFrom(current, jo);
    await updateDoc(doc(db, 'jobOrders', d.id), {
      ...migrated,
      schemaVersion: SCHEMA_VERSION,
    });
    console.log(`Migrated ${d.id} from v${current} → v${SCHEMA_VERSION}`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
```

---

## 7) Docs Generator (optional but helpful)

**`scripts/printFieldDocs.ts`**
```ts
import { FieldRegistry, SCHEMA_VERSION } from '../src/fields/registry';

(function main() {
  console.log(`# Field Registry (schema v${SCHEMA_VERSION})\n`);
  for (const f of Object.values(FieldRegistry)) {
    console.log(`## \`${f.id}\` — ${f.label}`);
    console.log(`- Type: \`${f.type}\``);
    if (f.options) console.log(`- Options: ${f.options.map(o => ` + r'`' + r'${o.value}' + r'`' + r`).join(', ')}`);
    console.log(`- usedBy: ${f.usedBy.join(', ')}`);
    if (f.required) console.log(`- required: true`);
    if (f.validator) console.log(`- validator: \`${f.validator}\``);
    if (f.tags?.length) console.log(`- tags: ${f.tags.join(', ')}`);
    if (f.deprecated) console.log(`- **DEPRECATED**`);
    console.log('');
  }
})();
```

Run and paste to your wiki:
```
ts-node scripts/printFieldDocs.ts > docs/fields.md
```

---

## 8) Hooking Up the UI

**Renderer pattern (pseudo-code)**
```tsx
// useFieldDef.ts
import { FieldRegistry } from '@/fields/registry';
export const useFieldDef = (fieldId: string) => FieldRegistry[fieldId];

// FormRenderer.tsx
function FormRenderer({ fieldIds, overrides }) {
  return (
    <>
      {fieldIds.map((id: string) => {
        const def = FieldRegistry[id];
        const ov  = overrides?.[id] ?? {};
        // choose component by 'type'; pass def.label, def.options, required, default, etc.
        return <FieldInput key={id} fieldId={id} def={{...def, ...ov}} />;
      })}
    </>
  );
}
```

**Deal Form**
```tsx
<FormRenderer fieldIds={DealFormFieldIds} />
```

**Job Order Form**
```tsx
<FormRenderer fieldIds={JobOrderFormFieldIds} overrides={JobOrderOverrides} />
```

> The inputs must **not** define their own label/options/types; they receive them from the registry.

---

## 9) End-to-End Flow (what should work after this PR)

1. Sales moves Deal to closing and clicks **Generate Job Order**.
2. System calls `createJobOrderFromDeal(deal)`:
   - Creates document with `initialSnapshot` (immutable) and `working` (editable).
   - Writes `schemaVersion = SCHEMA_VERSION`.
3. Recruiters edit **working** fields only; **As-Won** panel is read-only.
4. Any future registry changes:
   - Update `registry.ts`, bump `SCHEMA_VERSION` if breaking.
   - Parity script ensures forms stay aligned.
   - Run `scripts/migrateFields.ts` to upgrade legacy docs.

---

## 10) Guardrails & Tests (Cursor – add unit tests)

- **Parity test** (run `scripts/checkFieldParity.ts`) — must pass.
- **Mapping completeness** — ensure every `usedBy: Both` field is either:
  - present in both forms, or
  - intentionally excluded with a comment/reason.
- **Transform shape checks** — for fields using `transform`, validate output type/option is legal per registry.
- **Round-trip test** — create a mock Deal, generate a Job Order, assert Firestore shape + `schemaVersion`.
- **Migration test** — create a mock legacy Job Order (`schemaVersion` lower), run migration, assert coercions and updated version.

---

## Notes & Conventions

- **Never** hardcode field types/options in UI components. All come from the registry.
- Prefer **select enums** early; it simplifies validation and analytics.
- Use `deprecated: true` to mark fields for cleanup; parity script should warn if deprecated fields appear in forms.
- Keep registry changes in small PRs with clear migration notes.

---

## Done Criteria

- [ ] All files above created and compiled.
- [ ] Deal & Job Order forms render **only** from registry.
- [ ] Generate Job Order writes `initialSnapshot` + `working` + `schemaVersion`.
- [ ] CI parity script integrated and failing on drift.
- [ ] Migration script scaffolded and tested on at least one scenario (e.g., text → select).
- [ ] Minimal docs export available (`scripts/printFieldDocs.ts`).
