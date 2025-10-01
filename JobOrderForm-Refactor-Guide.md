# JobOrderForm Refactor & Usage Guide (for Cursor)

**Scope:** Recommendations to simplify and standardize `JobOrderForm.tsx` while keeping the flat Job Order Firestore shape and Phase 2 constraints (no Deal stage UI replatform).

---

## 1) Use the Registry for Labels and Options

Every field that exists in `src/fields/registry.ts` must source its **label** and, if applicable, **options** from `useFieldDef(fieldId)`.  
No hardcoded labels or inline option arrays.

### Example (text field)
```tsx
const def = useFieldDef('jobTitle');
<TextField label={def?.label ?? 'Job Title'} value={formData.jobTitle} onChange={...} />
```

### Example (select field)
```tsx
const def = useFieldDef('experienceLevel');
<Select label={def?.label ?? 'Experience Level'} value={formData.experienceLevel}>
  {(def?.options ?? []).map(o => (
    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
  ))}
</Select>
```

**Applies to:** jobTitle, experienceLevel, notes, payRate, startDate, endDate, workersNeeded, estimatedRevenue, priority, shiftType, companyId/companyName (labels), worksiteId/worksiteName (labels).

---

## 2) Centralize Helpers for Parsing/Formatting

Create helper functions in `JobOrderForm.tsx` or a small util file. Replace repeated try/catch blocks and inline conversions.

```ts
export const formatDateForInput = (v: any): string => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
};

export const parseDateFromInput = (v: string): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

export const toNumberSafe = (v: any): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

export const toCurrencyNumber = (v: any): number | undefined => toNumberSafe(v);

export const toBooleanSafe = (v: any): boolean | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true','yes','y','1','on'].includes(s)) return true;
  if (['false','no','n','0','off'].includes(s)) return false;
  return undefined;
};
```

Use these for all numeric/date/boolean fields in both **auto-save** and **manual save** paths.

---

## 3) Small Hooks to Reduce Boilerplate

### Date hook
```tsx
const useDateField = (fieldId: keyof typeof formData) => ({
  label: useFieldDef(fieldId as string)?.label ?? String(fieldId),
  value: formatDateForInput((formData as any)[fieldId]),
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleInputChange(fieldId as string, e.target.value),
  onBlur:   (e: React.FocusEvent<HTMLInputElement>)   => handleFieldBlur(fieldId as string, e.target.value),
});

// usage
const end = useDateField('endDate');
<TextField type="date" label={end.label} value={end.value} onChange={end.onChange} onBlur={end.onBlur} InputLabelProps={{ shrink: true }} />
```

### Text/number hook
```tsx
const useTextField = (fieldId: keyof typeof formData) => ({
  label: useFieldDef(fieldId as string)?.label ?? String(fieldId),
  value: (formData as any)[fieldId] ?? '',
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleInputChange(fieldId as string, e.target.value),
  onBlur:   (e: React.FocusEvent<HTMLInputElement>)   => handleFieldBlur(fieldId as string, e.target.value),
});
```

### Select hook
```tsx
const useSelectField = (fieldId: string) => {
  const def = useFieldDef(fieldId);
  return {
    label: def?.label ?? fieldId,
    options: def?.options ?? [],
  };
};
```

---

## 4) Normalize Data Flow

### Loading from Firestore
Use helpers for all date/number fields.
```ts
setFormData({
  ...prev,
  startDate: formatDateForInput(data.startDate),
  endDate:   formatDateForInput(data.endDate),
  payRate:   toNumberSafe(data.payRate),
  ...
});
```

### Auto-save & Manual Save
Unify with the same coercion logic.
```ts
const updates = {
  startDate: parseDateFromInput(dataToUse.startDate),
  endDate:   parseDateFromInput(dataToUse.endDate),
  payRate:   toCurrencyNumber(dataToUse.payRate),
  workersNeeded: toNumberSafe(dataToUse.workersNeeded),
  estimatedRevenue: toCurrencyNumber(dataToUse.estimatedRevenue),
  onsiteSupervisionRequired: toBooleanSafe(dataToUse.onsiteSupervisionRequired),
};
```

---

## 5) Mapping Alignment

If a field should copy from a Deal, ensure it’s covered in `mapDealToJobOrder` with the same helpers.

Example:
```ts
endDate: toISODate(deal.stageData?.qualification?.endDate),
payRate: toNumberSafe(deal.stageData?.qualification?.expectedAveragePayRate),
```

---

## 6) Checklist for Cursor

- [ ] All registry-backed fields use `useFieldDef(fieldId)` for labels/options.  
- [ ] Date fields use `formatDateForInput` / `parseDateFromInput`.  
- [ ] Numeric/currency fields use `toNumberSafe` / `toCurrencyNumber`.  
- [ ] Boolean fields use `toBooleanSafe`.  
- [ ] Auto-save and manual save share the same serialization function.  
- [ ] No inline option arrays for selects (priority, shiftType, experienceLevel).  
- [ ] `npm run check:parity` and `npm run test:mapping` pass cleanly.  

---

**Outcome:** Cleaner JobOrderForm with fewer references, consistent coercion, registry-driven labels/options, and ready for Phase 3 Deal form migration.

---

## 7) Concrete implementation steps (with diffs Cursor can apply)

> These are **illustrative unified diffs**. Adjust paths/names if your repo differs. Apply as small PRs.

### Step 1 — Add shared helpers (dates, numbers, booleans)

**File:** `src/recruiter/JobOrderForm.tsx` (top of file, after imports)

```diff
+ // ---- Shared coercion/formatting helpers ----
+ const formatDateForInput = (v: any): string => {
+   if (!v) return '';
+   const d = v instanceof Date ? v : new Date(v);
+   return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
+ };
+ 
+ const parseDateFromInput = (v: string): Date | null => {
+   if (!v) return null;
+   const d = new Date(v);
+   return isNaN(d.getTime()) ? null : d;
+ };
+ 
+ const toNumberSafe = (v: any): number | undefined => {
+   if (v === null || v === undefined || v === '') return undefined;
+   const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
+   return Number.isFinite(n) ? n : undefined;
+ };
+ 
+ const toCurrencyNumber = (v: any): number | undefined => toNumberSafe(v);
+ 
+ const toBooleanSafe = (v: any): boolean | undefined => {
+   if (v === null || v === undefined || v === '') return undefined;
+   if (typeof v === 'boolean') return v;
+   const s = String(v).trim().toLowerCase();
+   if (['true','yes','y','1','on'].includes(s)) return true;
+   if (['false','no','n','0','off'].includes(s)) return false;
+   return undefined;
+ };
```

---

### Step 2 — Normalize date **load** (replace ad-hoc try/catch)

**File:** `src/recruiter/JobOrderForm.tsx` (inside `loadJobOrder` → `setFormData({...})`)

```diff
- startDate: (() => {
-   const dateValue = data.startDate;
-   if (!dateValue) return '';
-   try {
-     const date = new Date(dateValue);
-     return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
-   } catch (error) {
-     console.warn('Invalid start date value:', dateValue);
-     return '';
-   }
- })(),
- endDate: (() => {
-   const dateValue = data.endDate;
-   if (!dateValue) return '';
-   try {
-     const date = new Date(dateValue);
-     return isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
-   } catch (error) {
-     console.warn('Invalid end date value:', dateValue);
-     return '';
-   }
- })(),
+ startDate: formatDateForInput((data as any).startDate),
+ endDate:   formatDateForInput((data as any).endDate),
```

---

### Step 3 — Normalize date **save** (auto-save & manual save)

**File:** `src/recruiter/JobOrderForm.tsx` (`saveFieldToFirestore` updates)

```diff
- startDate: dataToUse.startDate ? (() => {
-   try { const date = new Date(dataToUse.startDate); return isNaN(date.getTime()) ? null : date; } 
-   catch { return null; }
- })() : null,
- endDate: dataToUse.endDate ? (() => {
-   try { const date = new Date(dataToUse.endDate); return isNaN(date.getTime()) ? null : date; } 
-   catch { return null; }
- })() : null,
+ startDate: parseDateFromInput(dataToUse.startDate),
+ endDate:   parseDateFromInput(dataToUse.endDate),
```

**File:** `src/recruiter/JobOrderForm.tsx` (`handleSave` jobOrderData)

```diff
- startDate: formData.startDate ? (() => {
-   try { const d = new Date(formData.startDate); return isNaN(d.getTime()) ? null : d; } 
-   catch { return null; }
- })() : null,
- endDate: formData.endDate ? (() => {
-   try { const d = new Date(formData.endDate); return isNaN(d.getTime()) ? null : d; } 
-   catch { return null; }
- })() : null,
+ startDate: parseDateFromInput(formData.startDate),
+ endDate:   parseDateFromInput(formData.endDate),
```

---

### Step 4 — Make labels/options registry-driven (no hardcoded strings)

**File:** `src/recruiter/JobOrderForm.tsx` (JSX inputs)

```diff
- <TextField label="End Date" type="date" ... />
+ <TextField label={useFieldDef('endDate')?.label || 'End Date'} type="date" ... />

- <TextField label="Job Title *" ... />
+ <TextField label={(useFieldDef('jobTitle')?.label || 'Job Title') + ' *'} ... />

- <InputLabel>Priority</InputLabel>
+ <InputLabel>{useFieldDef('priority')?.label || 'Priority'}</InputLabel>

- {(useFieldDef('priority')?.options || []).map(...)} // (keep this; remove any local arrays)
```

Repeat for: `payRate, startDate, workersNeeded, estimatedRevenue, experienceLevel, shiftType, companyId/companyName (labels), worksiteId/worksiteName (labels)`.

---

### Step 5 — Standardize numeric coercion

**File:** `src/recruiter/JobOrderForm.tsx`

```diff
- workersNeeded: parseInt(dataToUse.workersNeeded.toString()) || 1,
- payRate: parseFloat(dataToUse.payRate) || 0,
- estimatedRevenue: parseFloat(dataToUse.estimatedRevenue) || 0,
+ workersNeeded: toNumberSafe(dataToUse.workersNeeded) ?? 1,
+ payRate: toCurrencyNumber(dataToUse.payRate) ?? 0,
+ estimatedRevenue: toCurrencyNumber(dataToUse.estimatedRevenue) ?? 0,
```

You can do the same conversion in `loadJobOrder` if you want the UI to always see normalized numbers.

---

### Step 6 — Optional micro-hooks to shrink JSX

**File:** `src/recruiter/JobOrderForm.tsx` (near helpers)

```diff
+ const useDateField = (fieldId: keyof typeof formData) => ({
+   label: useFieldDef(fieldId as string)?.label ?? String(fieldId),
+   value: formatDateForInput((formData as any)[fieldId]),
+   onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleInputChange(fieldId as string, e.target.value),
+   onBlur:   (e: React.FocusEvent<HTMLInputElement>)   => handleFieldBlur(fieldId as string, e.target.value),
+ });
+ 
+ const useSelectField = (fieldId: string) => {
+   const def = useFieldDef(fieldId);
+   return { label: def?.label ?? fieldId, options: def?.options ?? [] };
+ };
```

**Usage:**
```diff
+ const start = useDateField('startDate');
+ const end   = useDateField('endDate');
+ const pr    = useSelectField('priority');
+ const sh    = useSelectField('shiftType');

- <TextField type="date" label={useFieldDef('startDate')?.label || 'Start Date'} value={formData.startDate} ... />
+ <TextField type="date" label={start.label} value={start.value} onChange={start.onChange} onBlur={start.onBlur} ... />

- <InputLabel>{useFieldDef('priority')?.label || 'Priority'}</InputLabel>
+ <InputLabel>{pr.label}</InputLabel>
- {(useFieldDef('priority')?.options || []).map(...)}
+ {pr.options.map(...)}
```

---

### Step 7 — One source of truth for serialization (optional but nice)

Extract a `serializeJobOrder(formData, meta)` that both auto-save and manual save call.

```diff
+ const serializeJobOrder = (fd: typeof formData, meta: { tenantId: string; userId: string; companyName?: string; worksiteName?: string }) => ({
+   tenantId: meta.tenantId,
+   updatedAt: new Date(),
+   updatedBy: meta.userId,
+   jobOrderName: fd.jobOrderName,
+   jobOrderDescription: fd.description,
+   status: fd.status,
+   workersNeeded: toNumberSafe(fd.workersNeeded) ?? 1,
+   payRate: toCurrencyNumber(fd.payRate) ?? 0,
+   startDate: parseDateFromInput(fd.startDate),
+   endDate: parseDateFromInput(fd.endDate),
+   companyId: fd.companyId || '',
+   companyName: meta.companyName || '',
+   worksiteId: fd.worksiteId || '',
+   worksiteName: meta.worksiteName || '',
+   estimatedRevenue: toCurrencyNumber(fd.estimatedRevenue) ?? 0,
+   notes: fd.notes,
+ });
```

Then:
```diff
- const updates = { ...big object... }
+ const updates = serializeJobOrder(dataToUse, { tenantId, userId: user.uid, companyName, worksiteName });
```

Use the same in `handleSave` to avoid drift.

---

### Step 8 — Tests & parity

- Run `npm run test:mapping` (should remain green).  
- Run `npm run check:parity` (advisory). Confirm no hardcoded labels/options remain for registry-backed fields.

---

## 8) Ready-to-merge checklist (copy into PR)

- [ ] Registry-backed fields use `useFieldDef(fieldId)` for labels/options.  
- [ ] Date parsing/formatting centralized (no ad-hoc `new Date(...)` blocks).  
- [ ] Number/currency coercion centralized (no scattered `parseInt/parseFloat`).  
- [ ] Auto-save and manual save share identical serialization.  
- [ ] No inline arrays for select options (priority, shiftType, experienceLevel).  
- [ ] `npm run check:parity` and `npm run test:mapping` pass.  

---

**If you hit anything weird**, prefer adding a tiny helper (coercion/format/guard) rather than inlining logic in JSX. The goal is: **registry-driven metadata + one set of conversion rules**, so Phase 3 is trivial.
