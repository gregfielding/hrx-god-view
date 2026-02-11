# Smart Groups: Metro / Area / City Guidelines

This document describes how metros, areas (subareas), and cities are structured for Smart Groups. The app uses a **single built-in hierarchy** from `metroMaster.json`; there are no custom metros or Firestore-backed metro lists.

---

## Hierarchy

- **Metro** – A major metropolitan region (e.g. Dallas–Fort Worth, Austin, Houston), or “Other [State]” for non-CBSA areas.
- **Area (subarea)** – A named part of the metro (e.g. county, or “Other” for non-metro). When built from Census, subareas are counties.
- **City** – A city (or town) that belongs to exactly one area and one metro. Stored as `cityKey`: normalized `city_state` (lowercase, underscores), e.g. `plano_tx`, `houston_tx`.

---

## Key Rules

1. **Keys**: Use lowercase, underscores only. Examples: `dallas_fort_worth`, `north_dfw`, `plano_tx`.
2. **City key**: Normalize as `city_state` using the state two-letter abbreviation (e.g. `houston_tx`, `round_rock_tx`). The app uses `toCityKey(city, state)` for this.
3. **One city, one area, one metro**: Each city maps to a single subarea and a single metro.
4. **Labels**: Human-readable names; store a custom `label` per metro/area in the data.

---

## Source of truth: metroMaster.json

- **Built-in only**: All metro/area/city options come from **`src/data/metroMaster.json`**. The app does not read or write custom metros to Firestore.
- **Settings > Smart Groups** shows a read-only list of metros from this file (and a city search to see Metro → Area → City). There is no “Add metro” or “Delete metro” in the UI.
- **Do not edit metroMaster.json by hand** for ongoing changes. The only supported way to change or expand the hierarchy is to regenerate it using the data pipeline (see below). Exceptions (e.g. one-off fixes) must be documented.

### Data pipeline

- To regenerate the full US hierarchy, run **scripts/buildMetroMasterUS.js** with the required Census/OMB inputs (CBSA–county mapping, Places Gazetteer, Counties Gazetteer). See **src/data/README-metros.md** for step-by-step instructions and **scripts/data/README.md** for input file sources.
- The build ensures each city appears in exactly one metro and one subarea; metros are CBSA-based plus synthetic "Other [State]" for non-CBSA counties.

---

## Metro data structure (metroMaster.json)

Each metro in `metroMaster.json` has this shape:

```json
{
  "metroKey": "houston",
  "label": "Houston",
  "subareas": [
    {
      "subareaKey": "central",
      "label": "Central Houston",
      "cities": [
        { "cityKey": "houston_tx", "city": "Houston", "state": "TX", "coordinates": { "lat": null, "lng": null } }
      ]
    }
  ]
}
```

- **metroKey**: Unique key for the metro (lowercase, underscores).
- **label**: Display name.
- **subareas**: Array of areas. Each has **subareaKey**, **label**, and **cities** (array of `{ cityKey, city, state, coordinates }`).

The app derives a templates-style view (with `cityKeys` per subarea) from this file in `metroMaster.ts` for lookups and filters.

---

## Changelog

- Initial: guidelines and template structure for adding metros; Settings > Smart Groups and metro templates.
- Updated: built-in only; custom metros and Firestore removed; source of truth is metroMaster.json; Settings UI is read-only.
