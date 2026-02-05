# Smart Groups Reference

This document describes the Smart Groups feature: how it works, where it lives in the codebase, and how to extend or query it. Smart Groups is **separate from User Groups** and does not modify `userGroupIds` or `tenants/{tenantId}/userGroups`.

---

## Overview

Smart Groups derives "applicant pool" dimensions from **application events** and stores them on the **user Firestore document** (`users/{uid}`). When a user applies to a job, we:

1. Resolve the job's worksite (city, state, zip) to a **geographic hierarchy** (city → subarea → metro → state).
2. Resolve the job title to an **industry category** (industrial, hospitality, janitorial, or other).
3. Store a **per-application entry** and **summary arrays** on the user doc so we can query "users in Dallas who applied to Janitorial" without touching User Groups.

When a user **withdraws** an application, we remove that application's entry and recompute the summary arrays from remaining active applications.

---

## Constraint

- **User Groups remain unchanged.** No edits to `userGroupIds`, `tenants/{tenantId}/userGroups`, or any manual user group UI.
- Smart Groups uses a different field on the user doc (`smartGroupData`) and has no interaction with User Groups.

---

## Data Model (User Doc)

**Path:** `users/{uid}`

**New field:** `smartGroupData` (optional object)

```ts
interface SmartGroupData {
  cityKeys: string[];           // e.g. ["plano_tx", "mckinney_tx"]
  subareaKeys: string[];       // e.g. ["north_dfw", "south_dfw"]
  metroKeys: string[];         // e.g. ["dallas_fort_worth"]
  stateKeys: string[];         // e.g. ["texas"]
  industryCategories: string[]; // e.g. ["janitorial", "hospitality"]
  byApplication: Record<string, SmartGroupEntry>;
  updatedAt?: Timestamp;
}

interface SmartGroupEntry {
  jobTitle: string;
  worksiteCity: string;
  userAddressCity: string;
  userGeocoordinates?: { lat: number; lng: number };
  skills?: string[];
  jobCategory: "industrial" | "hospitality" | "janitorial" | "other";
  timestamp: any;
  cityKey: string;
  subareaKeys: string[];
  metroKey: string;
  stateKey: string;
  companyName?: string;
  companyId?: string;
  worksiteName?: string;   // worksite nickname
  worksiteId?: string;
  worksiteAddress?: { street?: string; city?: string; state?: string; zipCode?: string };
  worksiteGeocoordinates?: { lat: number; lng: number };
}
```

- **Summary arrays** (`cityKeys`, `subareaKeys`, `metroKeys`, `stateKeys`, `industryCategories`) are deduplicated across all **active** applications and used for querying/filtering.
- **byApplication** stores one entry per application so we know exactly what to remove on withdraw and can show per-application details: job title, worksite city, user address city, user geocoordinates, skills, job category, timestamp; **company** (companyName, companyId); **worksite** (worksiteName/nickname, worksiteId, worksiteAddress, worksiteGeocoordinates). All of these can be shown in a results table.

---

## Metro / Geographic Schema

**File:** [src/data/metroSubareaSchema.ts](src/data/metroSubareaSchema.ts)

- **Goal:** Resolve worksite `city`, `state`, `zipCode` to stable keys: `cityKey`, `subareaKeys[]`, `metroKey`, `stateKey`.
- **Approach:** Curated Craigslist-style hierarchy. Keys are normalized (lowercase, underscores), e.g. `plano_tx`, `north_dfw`, `dallas_fort_worth`, `texas`.
- **Resolver:** `getGeoHierarchy(worksite: { city?, state?, zipCode? })` returns `{ cityKey, subareaKeys, metroKey, stateKey }`.
- **Current coverage:** Dallas–Fort Worth (North DFW, South DFW, Mid Cities, Dallas, Fort Worth) and Austin area. Cities not in the map fall back to `cityKey` + `stateKey` and a synthetic `metroKey`; subareaKeys may be empty.
- **Adding metros:**
  - **Auto-generated from worksites:** When company worksite locations are created or updated in Firestore (company locations, customer worksites), the app calls `ensureCityInSmartGroups(tenantId, city, state)`. If the city is not already in the built-in hierarchy or in the tenant's custom metros, it either (1) adds the full metro from a template when the city appears in one (e.g. Houston), or (2) adds a standalone "metro" for that city so it appears in Smart Groups filters. Settings > Smart Groups still shows and edits these; auto-added metros are editable/removable.
  - **Settings > Smart Groups:** Manage custom metros in the Settings layout. "Add metro" lets you pick a metro from **templates**; areas and cities are populated automatically from the guideline-backed data. Custom metros are stored at `tenants/{tenantId}/settings/smartGroups` and merged with built-in metros for filter dropdowns on the Smart Groups tab.
  - **Guidelines:** [docs/SMART_GROUPS_METRO_GUIDELINES.md](docs/SMART_GROUPS_METRO_GUIDELINES.md) describes the metro/area/city structure and how to add new metro templates (in `src/data/metroTemplates.json`).
  - **Built-in:** Add entries to `CITY_TO_SUBAREA_AND_METRO` in `metroSubareaSchema.ts` for geo resolution on apply; add a template to `metroTemplates.json` and optionally to Settings so tenants can add that metro.
- **Backwards compatibility:** Applicants in cities not yet in the hierarchy (e.g. Evansville, IN) are stored with a fallback `metroKey` like `evansville_in_metro` and `cityKey` like `evansville_in`. They still appear when you use "All metros". When you later add that metro (e.g. Evansville) in Settings or built-in, filtering by that metro also matches those existing applicants by `cityKey`, so they continue to show without re-applying or backfilling.
- **Non-metro / rural:** Applicants in cities that aren’t in any defined metro (e.g. small towns, “middle of nowhere”) get a fallback `metroKey` like `random_town_tx_metro`. They appear when Metro = "All metros". The Metro dropdown also includes **"Other (non-metro)"**, which shows only applicants whose `metroKey` is not in the curated metro list (i.e. fallback metros). Area and City filters are hidden when "Other (non-metro)" is selected, since those applicants have no subarea/city in the hierarchy.

---

## Industry Category Mapping

**Location:** [src/services/smartGroupService.ts](src/services/smartGroupService.ts) – `resolveIndustryCategory(jobTitle)`

- **Categories:** `industrial`, `hospitality`, `janitorial`, `other`.
- **Method:** Keyword matching on job title (case-insensitive). Keywords are defined in the service (e.g. janitor, cleaner, custodial → janitorial; hotel, restaurant, server → hospitality; warehouse, manufacturing, forklift → industrial).
- **Extending:** Add keywords to `INDUSTRIAL_KEYWORDS`, `HOSPITALITY_KEYWORDS`, `JANITORIAL_KEYWORDS`, or add tenant/config overrides later.

---

## Service API

**File:** [src/services/smartGroupService.ts](src/services/smartGroupService.ts)

| Function | Purpose |
|----------|---------|
| `getGeoHierarchy(worksite)` | Implemented in [metroSubareaSchema.ts](src/data/metroSubareaSchema.ts); returns cityKey, subareaKeys, metroKey, stateKey. |
| `resolveIndustryCategory(jobTitle)` | Returns `industrial` \| `hospitality` \| `janitorial` \| `other`. |
| `updateUserSmartGroupOnApply(userId, tenantId, applicationId, params)` | Called after an application is created. Params: worksite, jobTitle, userAddressCity, userGeocoordinates, skills. Merges a new `SmartGroupEntry` into `byApplication` and recomputes summary arrays. |
| `updateUserSmartGroupOnWithdraw(userId, tenantId, applicationId)` | Called when an application is set to withdrawn. Removes `byApplication[applicationId]` and recomputes summary arrays. |

---

## Where It Is Wired

| Flow | File | When |
|------|------|------|
| Apply (full wizard) | [src/components/apply/Wizard.tsx](src/components/apply/Wizard.tsx) | After `setDoc` that updates user's `applicationIds` and `applicationData`, we call `updateUserSmartGroupOnApply` with worksite from posting, job title, user's city/coords/skills from the form. |
| Apply (quick apply) | [src/utils/quickApplicationSubmit.ts](src/utils/quickApplicationSubmit.ts) | After updating user's `applicationData`, we call `updateUserSmartGroupOnApply` with worksite from job posting, job title, user's city/coords/skills from user doc. |
| Withdraw | [src/pages/JobPostingDetail.tsx](src/pages/JobPostingDetail.tsx) | After `updateDoc` that sets application status to `withdrawn`, we call `updateUserSmartGroupOnWithdraw(userId, tenantId, applicationDocId)`. |

---

## Querying Smart Groups (Future)

To build a "Smart Group" UI (e.g. "users in Dallas who applied to Janitorial"):

1. **Query users** where `smartGroupData.metroKeys` array-contains or equals the desired metro (e.g. `dallas_fort_worth`) and `smartGroupData.industryCategories` array-contains the desired category (e.g. `janitorial`). Firestore: `where('smartGroupData.metroKeys', 'array-contains', 'dallas_fort_worth')` and `where('smartGroupData.industryCategories', 'array-contains', 'janitorial')` (requires composite index).
2. **Results table** can show columns from each user's `smartGroupData.byApplication`: job title, worksite city, user address city, user geocoordinates, skills, job category, timestamp; **company** (companyName, companyId); **worksite** (worksiteName/nickname, worksiteId, worksiteAddress, worksiteGeocoordinates); plus **interview score** (`user.scoreSummary.interviewAvg`) and **AI score** (`user.scoreSummary.aiScore`) from the same user doc.

---

## Firestore Rules

Ensure the same principals that can update `users/{uid}` on apply/withdraw can also write the `smartGroupData` field. No rule changes are required for `userGroups`.

---

## Files Summary

| File | Purpose |
|------|---------|
| [src/data/metroSubareaSchema.ts](src/data/metroSubareaSchema.ts) | Geo hierarchy: city → subarea → metro → state; `getGeoHierarchy()`, `toCityKey()`, `toStateKey()`; merged filter helpers `getMergedMetroOptions()`, `getMergedSubareaOptionsForMetro()`, `getMergedCityOptionsForSubarea()`. |
| [src/data/metroTemplates.json](src/data/metroTemplates.json) | Predefined metro templates (metro → areas → cities) for "Add metro" in Settings > Smart Groups. |
| [docs/SMART_GROUPS_METRO_GUIDELINES.md](docs/SMART_GROUPS_METRO_GUIDELINES.md) | Guidelines for metro/area/city structure and how to add metros and templates. |
| [src/hooks/useSmartGroupSettings.ts](src/hooks/useSmartGroupSettings.ts) | Load/save tenant custom metros from `tenants/{tenantId}/settings/smartGroups`. |
| [src/services/smartGroupMetroSync.ts](src/services/smartGroupMetroSync.ts) | `ensureCityInSmartGroups(tenantId, city, state)`: called when worksite locations are created/updated; adds city to custom metros (from template or standalone). |
| [src/pages/TenantViews/SmartGroupsSettings.tsx](src/pages/TenantViews/SmartGroupsSettings.tsx) | Settings > Smart Groups tab: list metros, add metro from template, remove custom metros. Metros may be auto-generated from worksites and are editable here. |
| [src/services/smartGroupService.ts](src/services/smartGroupService.ts) | Industry resolver, `updateUserSmartGroupOnApply`, `updateUserSmartGroupOnWithdraw`; types `SmartGroupData`, `SmartGroupEntry`. |
| [src/types/UserProfile.ts](src/types/UserProfile.ts) | User profile type includes optional `smartGroupData`. |
| [src/components/apply/Wizard.tsx](src/components/apply/Wizard.tsx) | Calls `updateUserSmartGroupOnApply` after application + user doc update. |
| [src/utils/quickApplicationSubmit.ts](src/utils/quickApplicationSubmit.ts) | Calls `updateUserSmartGroupOnApply` after application data update. |
| [src/pages/JobPostingDetail.tsx](src/pages/JobPostingDetail.tsx) | Calls `updateUserSmartGroupOnWithdraw` after setting application to withdrawn. |

---

## Changelog

- **Initial implementation:** Metro schema (Dallas–Fort Worth, Austin), industry categories (industrial, hospitality, janitorial, other), user-doc `smartGroupData` with per-application entries and summary arrays; apply flow (Wizard + quick apply) and withdraw flow (JobPostingDetail) wired.
- **Data object extended:** Per-application entry now includes company (companyName, companyId) and worksite (worksiteName/nickname, worksiteId, worksiteAddress, worksiteGeocoordinates).
