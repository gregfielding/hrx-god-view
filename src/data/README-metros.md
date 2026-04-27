# Metro data (Smart Groups)

The **single source of truth** for the Smart Groups geographic hierarchy (Metro → Area → City) is **`metroMaster.json`** in this directory. The app uses only this built-in list; there are no custom metros stored in Firestore. Custom metros have been removed; the UI shows only the built-in hierarchy from `metroMaster.json`.

## Structure

- **metroKey**: unique id (e.g. `los_angeles`, `salt_lake_city`).
- **label**: display name.
- **subareas**: list of areas within the metro, each with `subareaKey`, `label`, and **cities** (array of `{ cityKey, city, state, coordinates }`).

City keys are produced by `toCityKey(city, state)` in `metroSubareaSchema.ts`: lowercase, underscores, no special chars (e.g. "Lebec", "CA" → `lebec_ca`). The app also derives `metroTemplates`-style data (with `cityKeys` per subarea) from `metroMaster.json` via `metroMaster.ts`.

## Rules ("law" for metro data)

1. **One city, one metro, one subarea:** Each `cityKey` appears in exactly one metro and one subarea. A city is never in both a named CBSA metro and "Other [State]."
2. **Metros:** Named metros = CBSA (MSA/Micropolitan) from OMB/Census; subareas = counties within that CBSA.
3. **Other [State]:** One synthetic metro per state for all places in counties that are **not** in any CBSA; subarea = "Other."
4. **Place → County:** The build derives county from place coordinates using the Census Counties Gazetteer (nearest county centroid), not from the Place GEOID (which is state + place FIPS only).

---

## Regenerating metroMaster.json (full US from Census/OMB)

To build or refresh `metroMaster.json` so it covers the **entire United States** (CBSA metros plus “Other [State]” for non-metro places), use the Census-based pipeline:

1. **Get the input data** (see **scripts/data/README.md** for details):
   - **CBSA–county mapping:** e.g. NBER `cbsa2fipsxw_2023.csv` or Census delineation CSV.
   - **Places:** Census [2020 Gazetteer Places](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html) → `2020_Gaz_place_national.txt`. **Note:** Place GEOID in this file is **State FIPS (2) + Place FIPS (5)** — it does **not** contain county. The build does **not** use GEOID to infer county.
   - **Counties:** Census [2020 Gazetteer Counties](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html) → `2020_Gaz_counties_national.txt`. Used to assign each place to a county by nearest centroid (place coordinates → county FIPS → CBSA).

2. **Run the build script** from the repo root:

   ```bash
   node scripts/buildMetroMasterUS.js
   ```

   Or with explicit paths:

   ```bash
   node scripts/buildMetroMasterUS.js path/to/cbsa.csv path/to/places.txt path/to/counties.txt
   ```

3. Output is written to **`src/data/metroMaster.json`**. Back up the existing file first if needed.

The script assigns each place to the **nearest county** (by centroid distance), then looks up that county in the CBSA file. Counties not in any CBSA are assigned to **Other [State]**. Each `cityKey` is assigned only once (first occurrence wins). Subareas are counties for CBSA metros, or "Other" for Other [State].

---

## Other ways to build or edit metro data

- **csvToMetroTemplates.js** – Convert a CSV (metro, area, city, state) into a templates-style JSON. The output uses `cityKeys` per subarea. To get full `metroMaster.json` shape (with `city`, `state`, `coordinates` per city), run **migrateMetroTemplatesToMaster.js** on the generated templates (or on `metroTemplates.json`) to produce `metroMaster.json`.
- **add-metro-for-worksite.js** – Add a single metro/city for an unknown worksite using the Census Geocoder; appends to `metroTemplates.json`. After editing templates, run **migrateMetroTemplatesToMaster.js** if you want to update `metroMaster.json` from templates.

For full US coverage, the preferred path is **buildMetroMasterUS.js** with Census CBSA + places files as above.
