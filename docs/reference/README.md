# Reference data snapshots

Point-in-time exports from external systems, kept for seeding/matching
reference. These are **snapshots, not systems of record** — the live
mapping tables in Firestore own the truth once seeded.

## sodexo-site-list-2026-07-06.csv

Full Sodexo site directory (52,871 sites) for the Fieldglass order-intake
pipeline (see the Fieldglass → HRX intake project). Columns: Site (name),
Site Code (stable key, e.g. `0031990001`), City, Country/Region,
State/Province, ZIP, 3-digit ZIP. The leading `Yes/No` column is empty in
this export.

Notes:
- Fieldglass job-posting notification emails carry the **exact** Site name
  used here (verified: "PSH LANCASTER MED CENTER FOOD" → 0031990001,
  Lancaster PA 17601), so site matching is an exact-key lookup against
  this list, with Google Places resolving name+city+state+ZIP to a street
  address (no street addresses in this export).
- The list is NOT static — Sodexo adds locations. New/unknown site names
  fall through to Places auto-resolution + the learn-once alias table;
  request a refreshed export periodically (dated filename per snapshot).
