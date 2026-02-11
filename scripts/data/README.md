# Data for buildMetroMasterUS.js

Place the following CSV files here to build full US `metroMaster.json` from Census/OMB data.

## 1. CBSA–county mapping

**Source:** Census Bureau Core Based Statistical Area delineation file (counties in each MSA/Micropolitan area).

- **CSV (easiest):** [NBER CBSA–FIPS county crosswalk](https://www.nber.org/research/data/census-core-based-statistical-area-cbsa-federal-information-processing-series-fips-county-crosswalk) → **CSV** (e.g. `cbsa2fipsxw_2023.csv`). Download and place in this directory; the script accepts columns `cbsacode`, `cbsatitle`, `fipsstatecode`, `fipscountycode`, `countycountyequivalent`.
- **Or:** [Census Delineation Files](https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html) → **List 1** (Excel). Download, open, **Save As CSV** as `cbsa_counties.csv`.

**Expected columns** (header names are normalized to lowercase with spaces → underscores):

| Column (any of these) | Description |
|----------------------|-------------|
| `cbsa_code` / `cbsa` | CBSA code |
| `cbsa_title` / `title` | CBSA name (e.g. "Dallas-Fort Worth-Arlington, TX") |
| `state_fips` / `fips_state` / `fips_state_code` | 2-digit state FIPS |
| `county_fips` / `fips_county` / `fips_county_code` | 3-digit county FIPS |
| `county_name` / `county` (optional) | County name for subarea label |

## 2. Places (cities/towns)

**Source:** Census Bureau 2020 Gazetteer – incorporated places and Census Designated Places (CDPs).

- **URL:** [2020 Gazetteer Files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html) → **Places** → `2020_Gaz_place_national.zip` from [2020_Gazetteer](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/). Unzip to get `2020_Gaz_place_national.txt` (tab-delimited).
- **Important:** In the Census 2020 Gazetteer **Places** file, **GEOID is State FIPS (2) + Place FIPS (5)**. It does **not** contain county. The script therefore does **not** derive county from GEOID; it uses place coordinates (INTPTLAT, INTPTLONG) and the Counties Gazetteer (file 3) to assign each place to a county.

**Expected columns:**

| Column (any of these) | Description |
|----------------------|-------------|
| `name` / `place_name` / `place` / `city` | Place name |
| `state` / `usps` / `state_abbr` / `state_id` | 2-letter state (e.g. CA) |
| `geoid` | 7-digit Place GEOID (state 2 + place 5) |
| `intptlat` / `intptlong` | Latitude/longitude (used for place→county lookup) |

## 3. Counties (for place→county lookup)

**Source:** Census Bureau 2020 Gazetteer – counties.

- **URL:** [2020 Gazetteer Files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html) → **Counties** → `2020_Gaz_counties_national.zip`. Unzip to get `2020_Gaz_counties_national.txt` and place it in this directory.
- The script uses this file to assign each place to a county: for each place (with INTPTLAT, INTPTLONG), it finds the **nearest county centroid** and uses that county’s FIPS for the CBSA lookup. This is required because the Places file does not include county.

**Expected columns:** `geoid` (5-digit state+county FIPS), `intptlat`, `intptlong`.

## Running the build

From the repo root:

```bash
node scripts/buildMetroMasterUS.js
```

Defaults: `scripts/data/cbsa2fipsxw_2023.csv`, `scripts/data/2020_Gaz_place_national.txt`, `scripts/data/2020_Gaz_counties_national.txt`.

Or pass paths explicitly:

```bash
node scripts/buildMetroMasterUS.js path/to/cbsa.csv path/to/places.txt path/to/counties.txt
```

Output is written to `src/data/metroMaster.json`. Back up the existing file if needed before overwriting. Each city appears in exactly one metro and one subarea.
