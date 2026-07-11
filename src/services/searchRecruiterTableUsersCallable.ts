/**
 * Server-side full-collection search for recruiter Users table (All users scope).
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export type SearchRecruiterTableUsersInput = {
  tenantId: string;
  /** Empty = no text filter; use with `groupId` / `stateCode` for filter-only scans. */
  searchQuery: string;
  /** Tenant user group id; omit when "all". */
  groupId?: string;
  /** USPS code (or name); omit when "all". */
  stateCode?: string;
  /** C1 entity: `select` | `workforce` | `events` */
  entityKey?: string;
  /** Employment lifecycle: `active` | `onboarding` | `terminated`; omit when "all". */
  employmentStatus?: string;
};

export type SearchRecruiterTableUsersResult = {
  userIds: string[];
  scannedDocuments: number;
  batches: number;
  capped: boolean;
};

export function callSearchRecruiterTableUsers(functions: Functions, payload: SearchRecruiterTableUsersInput) {
  return httpsCallable<SearchRecruiterTableUsersInput, SearchRecruiterTableUsersResult>(
    functions,
    'searchRecruiterTableUsers',
  )(payload);
}
