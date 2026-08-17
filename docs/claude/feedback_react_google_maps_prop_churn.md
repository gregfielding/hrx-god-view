# react google maps prop churn

> "@react-google-maps/api Autocomplete: ALL props must be identity-stable — inline options/handlers cause setOptions churn that deadens the suggestion dropdown on busy pages"

# @react-google-maps/api Autocomplete — props must be identity-stable

**Why:** The lib's `Autocomplete` is a PureComponent whose
`componentDidUpdate` unregisters/re-registers listeners AND calls
`autocomplete.setOptions()` whenever ANY prop identity changes. Pages
with live Firestore subscriptions (RecruiterAccountDetails etc.)
re-render constantly, so inline `options={{...}}` / inline handlers
call setOptions on every render — which RESETS the Places prediction
session. Symptom: suggestions render but clicking selects nothing
(dropdown deadened between paint and click). Proven 2026-07-09 in a
standalone harness: setOptions on an 80ms interval → dropdown can't
even stay open; no churn → click selects first try. (First-attempt fix
that only stabilized onPlaceChanged but ADDED an inline options object
made it deterministic-worse.)

**How to apply:** Every GoogleAutocomplete gets (1) module-level
`PLACES_AUTOCOMPLETE_OPTIONS` constant, (2) `useCallback` onLoad +
onPlaceChanged. Fixed in RecruiterAccountDetails,
RecruiterCompanyDetails, TenantViews/CompanyDetails,
AddWorkerManuallyWizard (commit 9d4f0c03). Diagnostic trick: repro
harness = UMD React + MUI + raw places widget served via preview
(node_modules has no UMD for the wrapper — replicate its ~10 lines).
Related: `.pac-container` z-index 1400 rule lives in src/index.css.

**Second (deeper) root cause, same day:** the app had THREE Maps
loaders building DIFFERENT script URLs (App.tsx LoadScript
libraries=['places','maps'] vs useLoadScript libraries=['places'] in
AddressStep + AddWorkerManuallyWizard). The lib's injectScript REMOVES
the loaded <script> and re-injects when the requested URL differs — so
visiting /users or the apply flow tore down + reloaded Maps
mid-session, orphaning all live Places widgets ("The provided Place ID
is no longer valid" on selection, empty address_components, orphan
.pac-containers) until hard refresh. Fix (a0662fe5):
`src/utils/googleMapsLoader.ts` exports GOOGLE_MAPS_LIBRARIES; EVERY
loader must use it. Never add a useLoadScript call with its own
libraries array.

**Third root cause (2026-07-09, "still can't pick the suggestion"):**
even with one clean Maps load + stable props, the pac-container's
MOUSE bindings were missing entirely — its Google-event registry
(`el.__e3_*` keys) held only `mouseout` (container) / `mouseover`
(items) while the input kept focus/blur/keydown/input. So suggestions
rendered, keyboard selection (ArrowDown+Enter) worked perfectly, but
clicks did nothing (mousedown fully propagated, defaultPrevented
false → Google's handler never ran). Cause of the missing binding
unknown (fresh tab, single script). Shipped fix: global
`installPacClickFallback()` (src/utils/pacClickFallback.ts, called
from index.tsx, commit f2778380) — document-capture mousedown on
`.pac-item` preventDefaults (keeps input focused), waits 150ms, and if
Google didn't consume the click drives the keyboard path to the
clicked index. Inert when Google's mouse handling works. Diagnostic
recipe: check `Object.keys(el.__e3_...)` on input vs pac-container to
see which listener set is missing.

**Fourth root cause, same day (empty city/state/zip after selection):**
INTERPOLATED addresses (no rooftop listing, e.g. "100 Carson Park
Drive, Eau Claire WI") get a SYNTHETIC place_id ("Eio..." base64 of
the description) — PlacesService.getDetails returns NOT_FOUND for it
(same failure family as the "provided Place ID is no longer valid"
toast), so getPlace() carries formatted_address but NO
address_components. The BROWSER Maps key is API-restricted:
`google.maps.Geocoder` → REQUEST_DENIED (client can't self-recover).
Fix: `placesGeocodeAddress` callable (functions, uses
GOOGLE_MAPS_SERVER_KEY like fieldglass serverGeocode) +
`resolvePlaceAddress()` in src/utils/placesAddress.ts — components →
server geocode → string-parse chain, wired into the account
Add-Location dialog and apply-wizard AddressStep (commits bd6014a2 +
ccc7de94). Diagnostics: localStorage `hrx_places_diag` (rolling 20,
SHARED across same-origin tabs — readable from another tab). Verified:
callable returns full components incl. zip + real place_id for the
exact failing address.

Also learned same session: manual child accounts link locations via
`associations.locations[]`, NOT top-level companyId/companyLocationId
(only the auto-create path stamps those) — any account→location
resolver needs both (see [[feature-indeed-flex-automation-roadmap]]).
