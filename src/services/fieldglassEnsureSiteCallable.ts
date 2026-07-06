/**
 * Wrapper for the `fieldglassEnsureSite` callable — the /shifts/log
 * "Create site + account" flow for Fieldglass (Sodexo) orders.
 *
 * Dry-run (`execute: false`) returns the resolution plan: what the site
 * directory says, whether the CRM location and child account already
 * exist, and what would be created. Execute performs the idempotent
 * create/link chain and stamps `siteResolution` on the review-queue row.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export interface FieldglassSiteDirectoryRow {
  siteName: string;
  siteCode: string;
  city: string;
  state: string;
  zip: string;
}

export interface FieldglassEnsureSiteInput {
  tenantId: string;
  siteName: string;
  /** Explicit directory pick — required on execute when the name is
   *  ambiguous in the directory. */
  siteCode?: string;
  requestId?: string;
  execute?: boolean;
  /** Client-side geocoded street address for a location being created. */
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    lat?: number;
    lng?: number;
  };
}

export type FieldglassLayerStatus =
  | 'exists'
  | 'would_create'
  | 'created'
  | 'would_link'
  | 'linked';

export interface FieldglassEnsureSiteResult {
  ok: true;
  dryRun: boolean;
  /** Set when auto mode declined to create (ambiguous/unknown site). */
  skipped?: 'needs_directory_pick' | 'not_in_directory';
  directory: {
    status: 'exact' | 'ambiguous' | 'not_in_directory';
    row?: FieldglassSiteDirectoryRow;
    candidates?: FieldglassSiteDirectoryRow[];
  };
  location: {
    status: FieldglassLayerStatus;
    id?: string;
    name: string;
    codeBackfilled?: boolean;
    /** Existing location has no street address — a backfill is offered. */
    missingStreet?: boolean;
    /** Street was patched onto an existing location this run. */
    streetBackfilled?: boolean;
    address?: { street: string; city: string; state: string; zipCode: string };
  };
  childAccount: {
    status: FieldglassLayerStatus;
    id?: string;
    name: string;
    matchedBy?: 'location_meta' | 'deterministic_id' | 'name';
  };
  stampedRequest: boolean;
  alreadyResolved?: { locationId: string; childAccountId: string };
}

export function callFieldglassEnsureSite(
  functions: Functions,
  payload: FieldglassEnsureSiteInput,
) {
  return httpsCallable<FieldglassEnsureSiteInput, FieldglassEnsureSiteResult>(
    functions,
    'fieldglassEnsureSite',
  )(payload);
}
