# Metro templates (Smart Groups)

`metroTemplates.json` defines metro areas used for Smart Groups geographic hierarchy: **Metro → Area → Cities**. When a worksite is added or a job order is updated with a city that appears in a template, the **full metro** is added to the tenant’s custom metros (and any standalone metro for that city is removed).

## Structure

- **metroKey**: unique id (e.g. `los_angeles`, `salt_lake_city`).
- **label**: display name.
- **subareas**: list of areas within the metro, each with `subareaKey`, `label`, and `cityKeys` (normalized `city_state`, e.g. `lebec_ca`, `joliet_il`).

City keys are produced by `toCityKey(city, state)` in `metroSubareaSchema.ts`: lowercase, underscores, no special chars (e.g. "Lebec", "CA" → `lebec_ca`).

---

## Bulk data: there is no single “every city by metro by area” file

There is **no single authoritative JSON** that has every US city organized by Metro → Area → Cities. What exists:

| Source | What it has | Limitation |
|--------|-------------|------------|
| **Census / OMB** | Metro (CBSA) ↔ **counties**; “principal cities” per metro | Delineation is **county-level**, not city-level. Cities (“incorporated places”) are in separate products (place ↔ county). You can derive Metro → Cities by joining place→county and county→CBSA. |
| **Census delineation files** | [List 1 (MSA list)](https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html) (Excel), [List 2 (principal cities)](https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html) | Excel only; metro ↔ counties, not metro ↔ all cities. |
| **SimpleMaps** | [US Cities](https://simplemaps.com/data/us-cities) (CSV, 31k+ cities), [US Metros](https://simplemaps.com/data/us-metros) (CSV) | Free tier has cities; check if a metro/region column exists so you can group by metro. “Area” (e.g. East Bay) is not standard. |
| **Craigslist** | [Sites list](https://www.craigslist.org/about/sites) | Metro names and “nearby” links only; no downloadable city list per metro/area. |

So in practice you can:

1. **Use our import tools** with a JSON or CSV you build or obtain (e.g. from Census + place data, or SimpleMaps), then run the converter/import (see below).
2. **Keep expanding** `metroTemplates.json` by hand or from regional lists (e.g. “Greater Houston” cities from Wikipedia) as we’ve been doing.
3. **Derive Metro → Cities** from Census (county→CBSA + place→county), then optionally use **county as “area”** or add areas in a second pass.

---

## Import scripts (repo root)

To add a metro when a new job order has a worksite city not in any template, see **§ Add a metro for an unknown worksite** below.

### 1. Import a JSON file that matches our schema

If you have (or build) a JSON file with Metro → Area → cityKeys:

```bash
node scripts/importMetroTemplates.js path/to/your-metros.json
```

- **Backs up** current `src/data/metroTemplates.json` to `metroTemplates.json.bak`.
- **Overwrites** `src/data/metroTemplates.json` with the contents of your file.

**Expected JSON shape** — either an array of metros:

```json
[
  {
    "metroKey": "houston",
    "label": "Houston",
    "subareas": [
      { "subareaKey": "south", "label": "South Houston", "cityKeys": ["pearland_tx", "webster_tx"] }
    ]
  }
]
```

Or an object with a `metros` array:

```json
{
  "metros": [ ... ]
}
```

`metroKey` / `subareaKey` can be omitted; they will be derived from `label` (lowercase, underscores).

### 2. Convert a CSV into our JSON, then import

If you have a CSV with columns like **metro (or metro_name)**, **area (or area_name)**, **city**, **state**:

```bash
node scripts/csvToMetroTemplates.js path/to/cities-by-metro.csv > generated-metros.json
node scripts/importMetroTemplates.js generated-metros.json
```

- Column names are case-insensitive; spaces become underscores (e.g. `metro_name`, `area_name`).
- **state**: 2-letter (e.g. TX) or full name (e.g. Texas).
- Optional: `metro_key`, `area_key`; if missing, keys are derived from the names.

Example CSV:

```csv
metro_name,area_name,city,state
Houston,South Houston,Pearland,TX
Houston,South Houston,Webster,TX
San Francisco Bay Area,East Bay,Dublin,CA
```

After conversion, run `importMetroTemplates.js` on `generated-metros.json` to replace the app’s metro templates.

---

## Scaling and “area” names

### 3. Add a metro for an unknown worksite (new job order)

When a **new job order** is created and the worksite city is **not** in any metro template, run:

```bash
node scripts/add-metro-for-worksite.js "City" "ST"
node scripts/add-metro-for-worksite.js "City" "ST" "ZIP"
```

The script uses the **Census Geocoder** (no API key) to resolve the city to a CSA or MSA, then **appends** that metro to `metroTemplates.json` with at least the worksite city. If the metro already exists, it adds the city. For rural locations use `--standalone`. Optional: add `scripts/data/cbsa-principal-cities.json` (GEOID → `[{ "city", "state" }]`) to include principal cities.

---

- **Craigslist** is a good reference for metro and subarea names (e.g. [sfbay](https://sfbay.craigslist.org), [los angeles](https://losangeles.craigslist.org)).
- **Top 200 MSAs**: You can build or find a list of the largest metros and map them to metro keys and subareas; include outlying cities (e.g. Joliet for Chicago, Webster for Houston) so sync adds the full metro instead of a single-city “metro”.
- **“Area”** (East Bay, North Chicago, South Houston) is not in Census; it’s regional convention. Use Census county as a proxy for “area” if you build from Census, or define areas from Craigslist / local lists.

When adding a new metro, include suburbs and exurbs so that adding a job in any of those cities adds the full metro (see `smartGroupMetroSync.ts` and `findTemplateContainingCity`).
