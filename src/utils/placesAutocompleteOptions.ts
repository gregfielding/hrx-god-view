/**
 * Shared Google Places Autocomplete options (2026-08-12 billing fix).
 *
 * Without a `fields` restriction, every `getPlace()` bills at the
 * "Place Details Enterprise + Atmosphere" SKU (~$22/1000 — Google returns
 * reviews/photos/hours we never read). $190 in the first 12 days of
 * August came from exactly this. Restricting to address-only fields
 * drops each selection to the cheap address tier.
 *
 * MUST stay a module-level const: @react-google-maps/api re-runs
 * setOptions on every identity change, which breaks suggestion clicks
 * (see feedback_react_google_maps_prop_churn).
 */
export const PLACES_ADDRESS_FIELDS_OPTIONS: google.maps.places.AutocompleteOptions = {
  fields: ['address_components', 'formatted_address', 'geometry', 'place_id', 'name'],
};
