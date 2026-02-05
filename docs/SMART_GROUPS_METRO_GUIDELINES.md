# Smart Groups: Metro / Area / City Guidelines

This document describes how metros, areas (subareas), and cities are structured for Smart Groups. Use it when adding new metros via **Settings > Smart Groups** or when defining new metro templates so the code and UI can populate areas and cities consistently.

---

## Hierarchy

- **Metro** – A major metropolitan region (e.g. Dallas–Fort Worth, Austin, Houston).
- **Area (subarea)** – A named part of the metro (e.g. North DFW, South DFW, Central Houston). Craigslist-style regions work well.
- **City** – A city (or town) that belongs to exactly one area and one metro. Stored as `cityKey`: normalized `city_state` (lowercase, underscores), e.g. `plano_tx`, `houston_tx`.

---

## Key Rules

1. **Keys**: Use lowercase, underscores only. Examples: `dallas_fort_worth`, `north_dfw`, `plano_tx`.
2. **City key**: Normalize as `city_state` using the state two-letter abbreviation (e.g. `houston_tx`, `round_rock_tx`). The app uses `toCityKey(city, state)` for this.
3. **One city, one area, one metro**: Each city maps to a single subarea and a single metro.
4. **Labels**: Human-readable names are derived from keys by replacing `_` with spaces and title-casing (e.g. `north_dfw` → "North Dfw"). For display you can store a custom `label` per metro/area in templates.

---

## Auto-generation from worksites

When company worksite locations are created or updated (company locations, customer worksites), the app ensures the worksite’s city is represented in Smart Groups:

- If the city is already in the built-in hierarchy or in the tenant’s custom metros, nothing is changed.
- If the city appears in a metro **template** (e.g. Houston), that full metro is added to the tenant’s custom metros (areas and cities from the template).
- Otherwise a **standalone** metro is added for that city (one “Other” area, one city) so it appears in filters.

Metros added this way are stored in `tenants/{tenantId}/settings/smartGroups` and can be viewed, edited, or removed in **Settings > Smart Groups**.

---

## Adding a Metro (Settings UI)

1. Go to **Settings > Smart Groups**.
2. Click **Add metro**.
3. Pick a metro from the **template** list (predefined metros that follow these guidelines).  
   - Choosing a template fills **areas** and **cities** automatically from the guideline-backed data.
4. Optionally edit areas/cities before saving.
5. Save to add the metro to your tenant. It will appear in the Smart Groups tab filter (Metro → Area → City).

Templates are defined in `src/data/metroTemplates.json`. To add a new metro template (e.g. for a new region), add an entry there that matches the structure below; then it will appear in the "Add metro" dropdown and areas/cities will populate from that template.

---

## Metro Template Structure (JSON)

Each metro in `metroTemplates.json` has this shape:

```json
{
  "metroKey": "houston",
  "label": "Houston",
  "subareas": [
    {
      "subareaKey": "central",
      "label": "Central Houston",
      "cityKeys": ["houston_tx", "bellaire_tx", "west_university_place_tx"]
    },
    {
      "subareaKey": "north",
      "label": "North Houston",
      "cityKeys": ["spring_tx", "the_woodlands_tx", "conroe_tx"]
    }
  ]
}
```

- **metroKey**: Unique key for the metro (lowercase, underscores).
- **label**: Display name (e.g. "Houston").
- **subareas**: Array of areas. Each has:
  - **subareaKey**: Unique key within the metro.
  - **label**: Display name for the area.
  - **cityKeys**: Array of `city_state` keys (e.g. `houston_tx`).

When a user adds a metro from a template, the app copies this structure into tenant settings so that the Smart Groups filters (Metro → Area → City) show the correct options without editing code.

---

## Built-in vs Custom Metros

- **Built-in**: Defined in `src/data/metroSubareaSchema.ts` (e.g. Dallas–Fort Worth, Austin). Used for resolving worksite city/state to metro/area when applications are created.
- **Custom**: Stored in Firestore at `tenants/{tenantId}/settings/smartGroups`. Used for **filter dropdowns** on the Smart Groups tab. Custom metros can later be used for geo resolution when we support tenant-specific hierarchy in the apply flow.

---

## Changelog

- Initial: guidelines and template structure for adding metros; Settings > Smart Groups and metro templates.
