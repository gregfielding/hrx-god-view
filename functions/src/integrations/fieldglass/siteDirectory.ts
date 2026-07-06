/**
 * **Sodexo site directory — bundled lookup (FG Slice 3).**
 *
 * Fieldglass notification emails carry the EXACT site name from Sodexo's
 * site export (verified: "PSH LANCASTER MED CENTER FOOD" = Site Code
 * 0031990001), so resolution is a keyed lookup, not fuzzy matching. The
 * 52,872-row export is bundled as `functions/assets/sodexoSiteDirectory.json`
 * (generated from `docs/reference/sodexo-site-list-2026-07-06.csv` — refresh
 * BOTH together when Sodexo ships a new export; the list grows over time).
 *
 * Site Codes are globally unique in the export. Site NAMES are not: ~5%
 * (2,187 of 42k names) repeat under different codes, so name lookup returns
 * an array and callers must disambiguate (usually by city/state, ultimately
 * by the recruiter picking one).
 *
 * Loaded lazily via fs.readFileSync on first use — NOT a resolveJsonModule
 * import, which would drag 3.4MB into every function's cold-start module
 * graph. Only the callable that needs it pays the ~50ms parse, once per
 * instance.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SodexoSiteRow {
  siteName: string;
  siteCode: string;
  city: string;
  state: string;
  zip: string;
}

/** Uppercase and collapse everything non-alphanumeric to single spaces —
 *  tolerant of punctuation/spacing drift between the email and the export. */
export function normalizeSiteName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

interface DirectoryIndex {
  byCode: Map<string, SodexoSiteRow>;
  byNormalizedName: Map<string, SodexoSiteRow[]>;
  rowCount: number;
}

let cached: DirectoryIndex | null = null;

function assetPathCandidates(): string[] {
  // lib/integrations/fieldglass → up 3 = functions root (rootDir src → lib).
  return [
    path.join(__dirname, '..', '..', '..', 'assets', 'sodexoSiteDirectory.json'),
    path.join(process.cwd(), 'assets', 'sodexoSiteDirectory.json'),
  ];
}

function loadIndex(): DirectoryIndex {
  if (cached) return cached;
  const file = assetPathCandidates().find((p) => fs.existsSync(p));
  if (!file) {
    throw new Error(
      `sodexoSiteDirectory.json not found (looked in: ${assetPathCandidates().join(', ')})`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    rows: Array<[string, string, string, string, string]>;
  };
  const byCode = new Map<string, SodexoSiteRow>();
  const byNormalizedName = new Map<string, SodexoSiteRow[]>();
  for (const [siteName, siteCode, city, state, zip] of parsed.rows) {
    const row: SodexoSiteRow = { siteName, siteCode, city, state, zip };
    byCode.set(siteCode, row);
    const key = normalizeSiteName(siteName);
    if (!key) continue;
    const bucket = byNormalizedName.get(key);
    if (bucket) bucket.push(row);
    else byNormalizedName.set(key, [row]);
  }
  cached = { byCode, byNormalizedName, rowCount: parsed.rows.length };
  return cached;
}

export function lookupSiteByCode(siteCode: string): SodexoSiteRow | null {
  const code = String(siteCode ?? '').trim();
  if (!code) return null;
  return loadIndex().byCode.get(code) ?? null;
}

/** All directory rows whose normalized name matches. Empty array = the
 *  site isn't in this snapshot of the export (Sodexo adds sites; the
 *  recruiter falls back to a manually-addressed location). */
export function lookupSitesByName(siteName: string): SodexoSiteRow[] {
  const key = normalizeSiteName(siteName);
  if (!key) return [];
  return loadIndex().byNormalizedName.get(key) ?? [];
}

export function siteDirectoryRowCount(): number {
  return loadIndex().rowCount;
}
