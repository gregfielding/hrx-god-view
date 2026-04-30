/**
 * W.3 — feature flag controlling whether the web app COLLECTS
 * work-authorization attestations from workers.
 *
 * Why a flag (and not a hard delete): per the work-auth-removal-audit
 * (Phase 1 / Option C + Option B contractor variant), the data side moved
 * to W.1's server-side mirror — `users.workEligibility` and
 * `users.workEligibilityAttestation` are now populated authoritatively from
 * Everee I-9 (W-2) or the federal contractor rule (1099). The collection
 * surfaces (apply wizard step 4, profile editor, add-worker checkbox, CSV
 * template column, worker app narrative + profile sidebar) become
 * redundant — but the audit explicitly asked for a single-deploy rollback
 * path, so we hide them behind one flag instead of deleting them.
 *
 * **Default = `true` (collection disabled).** Flip to `false` to restore
 * every collection point. The flip is a single source-line change + redeploy
 * since this is a build-time constant. An env override is provided for
 * local dev / e2e tests so a developer can toggle without rebuilding.
 *
 * **Why not the existing `featureFlags.ts` per-tenant Firestore mechanism:**
 * the existing helper is async (Firestore-backed) and would force every
 * render-time hide/show into an async loading state. The work-auth hide
 * is a global rollout (not per-tenant), and synchronous + cheap is the
 * right shape. If we ever need per-tenant overrides, layer a hook on top
 * of this constant later.
 *
 * **W.4 (Flutter) mirrors this behavior on `c1_app`.** Web + Flutter
 * should deploy in the same week to avoid drift; old Flutter clients
 * writing fields the web no longer asks for is non-broken (server still
 * accepts the writes), just inconsistent.
 *
 * **Out of scope for W.3:** gate changes (W.5), data deletion (W.6),
 * Flutter changes (W.4). Display surfaces (chip, header, table rows)
 * are NOT touched — they continue to read from
 * `users.workEligibility` which W.1's mirror keeps fresh.
 */

/**
 * Single source of truth. Flip to `false` to roll back: every collection
 * surface restores in one deploy. NEVER read this constant directly from
 * outside this module — always go through `isWorkAuthCollectionDisabled()`
 * so the env override applies uniformly.
 */
const WORK_AUTH_COLLECTION_DISABLED_DEFAULT = true;

/**
 * Returns true when the web app should HIDE every work-authorization
 * collection surface. Defaults to the constant above; an env override
 * (`REACT_APP_WORK_AUTH_COLLECTION_DISABLED=true|false`) lets local dev
 * test both code paths without rebuilding.
 *
 * Synchronous by design — every consumer is a render-time gate.
 */
export function isWorkAuthCollectionDisabled(): boolean {
  // The build-time env var (Create React App / craco wires through
  // `REACT_APP_*`). String comparisons because process.env values arrive
  // as strings. We accept both 'true' / 'false' explicitly so an empty
  // string falls through to the default.
  const envValue =
    typeof process !== 'undefined' && process.env
      ? process.env.REACT_APP_WORK_AUTH_COLLECTION_DISABLED
      : undefined;
  if (envValue === 'true') return true;
  if (envValue === 'false') return false;
  return WORK_AUTH_COLLECTION_DISABLED_DEFAULT;
}

/**
 * Convenience inverse — useful for "show this collection surface when…"
 * conditionals where double-negation hurts readability.
 */
export function isWorkAuthCollectionEnabled(): boolean {
  return !isWorkAuthCollectionDisabled();
}
