import type { Libraries } from '@react-google-maps/api';

/**
 * THE single source of truth for the Google Maps script configuration.
 *
 * Why this must be shared (2026-07-09, "can't click the address
 * suggestion" + "The provided Place ID is no longer valid"):
 * @react-google-maps/api builds the script URL from the loader options —
 * including the libraries list — and its injectScript REMOVES the
 * existing <script> and re-injects whenever the requested URL differs
 * from the one already on the page. App.tsx loaded
 * `libraries=places,maps` while AddressStep / AddWorkerManuallyWizard
 * called useLoadScript with `libraries=places` — so merely visiting
 * those pages tore down and reloaded the Maps API mid-session,
 * orphaning every live Places widget (dead suggestion dropdowns,
 * duplicate .pac-containers, "Place ID is no longer valid" on
 * selection) until a hard refresh.
 *
 * Every loader (the <LoadScript> in App.tsx and every useLoadScript
 * call) MUST use this exact constant so the built URL is identical and
 * the already-loaded script is reused.
 */
export const GOOGLE_MAPS_LIBRARIES: Libraries = ['places', 'maps'];
