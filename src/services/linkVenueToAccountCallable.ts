/**
 * Wrapper for the `linkVenueToAccount` callable. The /shifts/log
 * "Link to account" UI uses this to lock in a recruiter-confirmed
 * venue → account alias so future Indeed Flex emails route via the
 * matcher's alias short-circuit instead of the fuzzy scorer.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export interface LinkVenueToAccountInput {
  tenantId: string;
  venueName: string;
  accountId: string;
  /** Optional — when set, re-runs the matcher on that specific log entry
   *  so the row flips from NEEDS REVIEW → MATCHED immediately. */
  requestId?: string;
}

export interface LinkVenueToAccountResult {
  ok: true;
  aliasDocId: string;
  aliasKey: string;
  accountName: string;
  rematchConfidence?: 'exact' | 'fuzzy' | 'multiple' | 'none';
  rematchedJobOrderId?: string;
}

export function callLinkVenueToAccount(
  functions: Functions,
  payload: LinkVenueToAccountInput,
) {
  return httpsCallable<LinkVenueToAccountInput, LinkVenueToAccountResult>(
    functions,
    'linkVenueToAccount',
  )(payload);
}
